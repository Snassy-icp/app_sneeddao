import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Debug "mo:base/Debug";
import Error "mo:base/Error";
import IC "mo:base/ExperimentalInternetComputer";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Timer "mo:base/Timer";
import Map "mo:map/Map";
import Sha256 "mo:sha2/Sha256";

import Hash "../icrc3/Hash";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import TextLog "../sneed_names/TextLog";
import ApiDoc "ApiDoc";
import CandidReply "CandidReply";
import T "Types";

/// sneed_proxy: every admin setting of Sneed DAO's canisters by SNS proposal (spec/sneed_proxy.md).
///
/// SNS governance calls one execute method per proposal topic (each registered as its own generic
/// nervous system function); the proxy checks the call against a stable allowlist of
/// (canister, method, class) and forwards it, as an admin of the target, with a bounded-wait call.
/// Every forwarded call is a block in the proxy's ICRC-3 log. The allowlist changes only by a
/// critical proposal (set_allowlist). No admins, no ingress updates, no tokens, no ICRC-85.
shared (deployer) persistent actor class SneedProxy(init : ?T.InitArgs) = this {

  public type Class = T.Class;
  public type ReplyMode = T.ReplyMode;
  public type ProxyCall = T.ProxyCall;
  public type Entry = T.Entry;
  public type EntryView = T.EntryView;
  public type CanisterName = T.CanisterName;
  public type AllowlistUpdate = T.AllowlistUpdate;
  public type ValidationResult = T.ValidationResult;
  public type InitArgs = T.InitArgs;
  public type Forwarded = T.Forwarded;
  public type ClassStats = T.ClassStats;
  public type Config = T.Config;
  public type LogEntry = T.LogEntry;

  // ---------------------------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------------------------

  let DEFAULT_GOVERNANCE = "fi3zi-fyaaa-aaaaq-aachq-cai"; // Sneed SNS governance
  let DEFAULT_ROOT = "fp274-iaaaa-aaaaq-aacha-cai"; // Sneed SNS root

  let FORWARD_TIMEOUT : Nat = 300; // seconds, the IC's maximum for bounded-wait calls
  let MAX_ARG_CAP : Nat = 65_536; // no entry may allow more (governance caps payloads anyway)
  let MAX_NOTE : Nat = 500;
  let MAX_METHOD : Nat = 100;
  let MAX_LABEL : Nat = 200;
  let MAX_NAME : Nat = 64;
  let MAX_UPDATE_ITEMS : Nat = 100;
  let HEX_SHOWN_UP_TO : Nat = 512; // arguments up to this size are shown in hex in the validator text
  let REPLY_LOGGED_UP_TO : Nat = 1_024; // replies up to this size are kept in the block
  let MAX_ERROR : Nat = 1_000;
  let RECENT_CAPACITY : Nat = 200;
  let DAY_SECONDS : Nat = 86_400;

  // The GNSFs this proxy expects (spec §1.2, §3.2). Ids are documentation: the proxy cannot see
  // which function called it, it knows the class from the method governance called.
  transient let FUNCTIONS : [T.FunctionInfo] = [
    { id = 6000; name = "Sneed Hub: app setting"; topic = "ApplicationBusinessLogic"; critical = false; target_method = "execute_business"; validator_method = "validate_business" },
    { id = 6001; name = "Sneed Hub: dapp maintenance"; topic = "DappCanisterManagement"; critical = false; target_method = "execute_dapp"; validator_method = "validate_dapp" },
    { id = 6002; name = "Sneed Hub: community setting"; topic = "DaoCommunitySettings"; critical = true; target_method = "execute_community"; validator_method = "validate_community" },
    { id = 6003; name = "Sneed Hub: critical dapp operation"; topic = "CriticalDappOperations"; critical = true; target_method = "execute_critical"; validator_method = "validate_critical" },
    { id = 6004; name = "Sneed Hub: treasury & fees"; topic = "TreasuryAssetManagement"; critical = true; target_method = "execute_treasury"; validator_method = "validate_treasury" },
    { id = 6010; name = "Sneed Hub: proxy allowlist"; topic = "CriticalDappOperations"; critical = true; target_method = "set_allowlist"; validator_method = "validate_set_allowlist" },
  ];

  // The proxy's own settings, reached through execute_dapp as calls to itself (spec §3.6).
  transient let BUILTINS : [(Text, Text)] = [
    ("self_set_icrc3_settings", "Change the proxy's ICRC-3 log settings"),
    ("self_icrc3_spill_now", "Move the proxy's ICRC-3 blocks to its archive now"),
    ("self_icrc3_repair_archive_controllers", "Repair the controllers of the proxy's ICRC-3 archives"),
    ("self_set_max_in_flight", "Set how many proposals the proxy forwards at once"),
  ];

  // ---------------------------------------------------------------------------------------------
  // State (enhanced orthogonal persistence)
  // ---------------------------------------------------------------------------------------------

  var governance : Principal = switch (init) {
    case (?i) i.governance;
    case null Principal.fromText(DEFAULT_GOVERNANCE);
  };
  var root : Principal = switch (init) {
    case (?i) i.root;
    case null Principal.fromText(DEFAULT_ROOT);
  };

  let entries = Map.new<(Principal, Text), Entry>();
  let names = Map.new<Principal, Text>();

  var sns_canisters : [Principal] = [];
  var sns_canisters_refreshed_at : ?Nat64 = null;
  var max_in_flight : Nat = 20;

  // per class: forwarded, ok, err, unknown
  var stats : [var (Nat, Nat, Nat, Nat)] = Array.init<(Nat, Nat, Nat, Nat)>(5, (0, 0, 0, 0));
  var recent : [var ?Forwarded] = Array.init<?Forwarded>(RECENT_CAPACITY, null);
  var recent_count : Nat = 0; // forwarded calls ever recorded; call i lives at i % RECENT_CAPACITY

  let textlog : TextLog.State = TextLog.init();
  var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();

  transient var in_flight : Nat = 0;
  transient var refresh_timers_started : Bool = false;

  transient let pthash = Map.combineHash(Map.phash, Map.thash);

  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/sneed_proxy#block-types";
    block_types = ["sneedproxy_forwarded", "sneedproxy_allowlist_set", "sneedproxy_allowlist_removed", "sneedproxy_canister_named", "sneedproxy_config"];
  };

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  func self() : Principal = Principal.fromActor(this);
  func nowNs() : Nat = Int.abs(Time.now());
  func now64() : Nat64 = Nat64.fromNat(nowNs());
  func pv(p : Principal) : T3.Value = Icrc3Log.principal(p);
  func sha256(b : Blob) : Blob = Sha256.fromBlob(#sha256, b);
  func hex(b : Blob) : Text = Hash.toHex(b);

  func classIndex(c : Class) : Nat = switch c {
    case (#business) 0;
    case (#dapp) 1;
    case (#community) 2;
    case (#critical) 3;
    case (#treasury) 4;
  };
  transient let CLASSES : [Class] = [#business, #dapp, #community, #critical, #treasury];
  func className(c : Class) : Text = switch c {
    case (#business) "business";
    case (#dapp) "dapp";
    case (#community) "community";
    case (#critical) "critical";
    case (#treasury) "treasury";
  };
  func classFunction(c : Class) : T.FunctionInfo = FUNCTIONS[classIndex(c)];
  func topicTitle(c : Class) : Text = switch c {
    case (#business) "Application Business Logic";
    case (#dapp) "Dapp Canister Management";
    case (#community) "DAO Community Settings (critical)";
    case (#critical) "Critical Dapp Operations (critical)";
    case (#treasury) "Treasury & Asset Management (critical)";
  };
  func replyName(r : ReplyMode) : Text = switch r { case (#any) "any"; case (#result) "result" };

  func isBuiltin(method : Text) : ?Text {
    for ((m, l) in BUILTINS.vals()) if (m == method) return ?l;
    null;
  };

  func builtinEntry(method : Text, l : Text) : Entry = {
    canister = self();
    method;
    class_ = #dapp;
    label_ = l;
    max_arg_bytes = 4_096;
    reply = #result;
    enabled = true;
  };

  /// The entry for (canister, method): a built-in self entry or an allowlist entry.
  func lookup(canister : Principal, method : Text) : ?(Entry, Bool) {
    if (canister == self()) {
      return switch (isBuiltin(method)) { case (?l) ?(builtinEntry(method, l), true); case null null };
    };
    switch (Map.get(entries, pthash, (canister, method))) { case (?e) ?(e, false); case null null };
  };

  func nameOf(canister : Principal) : ?Text {
    if (canister == self()) return ?"Sneed proxy";
    Map.get(names, Map.phash, canister);
  };

  func clip(t : Text, max : Nat) : Text {
    if (t.size() <= max) return t;
    var out = "";
    var n = 0;
    label chars for (c in t.chars()) {
      if (n >= max) break chars;
      out #= Text.fromChar(c);
      n += 1;
    };
    out # "…";
  };

  func isCanisterId(p : Principal) : Bool {
    let b = Blob.toArray(Principal.toBlob(p));
    b.size() == 10 and b[9] == 0x01;
  };

  /// Why this canister may never be a target (spec §3.3), whatever a proposal says.
  func hardRefusal(canister : Principal, method : Text) : ?Text {
    if (Principal.toText(canister) == "aaaaa-aa") return ?"The management canister is never a proxy target";
    if (canister == governance or canister == root or Array.find<Principal>(sns_canisters, func(c) = c == canister) != null) {
      return ?("SNS canisters are never proxy targets (" # Principal.toText(canister) # "); use native SNS proposals");
    };
    if (canister == self() and isBuiltin(method) == null) return ?"The proxy itself is a target only for its built-in self_* methods";
    null;
  };

  // ---------------------------------------------------------------------------------------------
  // Time formatting for the validator text
  // ---------------------------------------------------------------------------------------------

  func pad2(n : Nat) : Text = if (n < 10) "0" # Nat.toText(n) else Nat.toText(n);

  /// "2026-11-04 12:00:00 UTC" (proleptic Gregorian, from days since 1970-01-01).
  func utc(ns : Nat64) : Text {
    let secs = Nat64.toNat(ns) / 1_000_000_000;
    let days : Int = secs / DAY_SECONDS;
    let rem = secs % DAY_SECONDS;
    // H. Hinnant's civil_from_days
    let z = days + 719_468;
    let era = (if (z >= 0) z else z - 146_096) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if (mp < 10) mp + 3 else mp - 9;
    let year = if (m <= 2) y + 1 else y;
    Int.toText(year) # "-" # pad2(Int.abs(m)) # "-" # pad2(Int.abs(d)) # " " # pad2(rem / 3600) # ":" # pad2((rem % 3600) / 60) # ":" # pad2(rem % 60) # " UTC";
  };

  // ---------------------------------------------------------------------------------------------
  // ICRC-3 log
  // ---------------------------------------------------------------------------------------------

  func icrc3_env() : Icrc3Log.Environment {
    {
      self = self();
      archive_controllers = [root];
      cycle_reserve = 1_000_000_000_000;
      new_correlation_id = func() : Nat = TextLog.correlationId(textlog);
      log_info = func(cid : Nat, m : Text) = TextLog.add(textlog, #info, cid, self(), m);
      log_error = func(cid : Nat, m : Text) = TextLog.add(textlog, #error, cid, self(), m);
    };
  };

  func block(btype : Text, caller : Principal, tx : [(Text, T3.Value)]) : Nat {
    Icrc3Log.append(icrc3, "sneedproxy_" # btype, nowNs(), Array.append<(Text, T3.Value)>([("caller", pv(caller))], tx));
  };

  /// The payload's hash: the ICRC-3 representation-independent hash of its fields, so anyone can
  /// recompute it from a decoded proposal payload without caring how the bytes were encoded.
  func payloadHash(call : ProxyCall) : Blob {
    let fields = Buffer.Buffer<(Text, T3.Value)>(5);
    fields.add(("canister", pv(call.canister)));
    fields.add(("method", #Text(call.method)));
    fields.add(("arg", #Blob(call.arg)));
    switch (call.note) { case (?n) fields.add(("note", #Text(n))); case null {} };
    switch (call.expires_at) { case (?e) fields.add(("expires_at", #Nat(Nat64.toNat(e)))); case null {} };
    Hash.hashValue(#Map(Buffer.toArray(fields)));
  };

  // ---------------------------------------------------------------------------------------------
  // Checks shared by the validators and the execute methods
  // ---------------------------------------------------------------------------------------------

  /// The entry a call through `cls` would use, or why the call is refused.
  func check(cls : Class, call : ProxyCall) : { #ok : (Entry, Bool, Text); #err : Text } {
    switch (call.note) {
      case (?n) if (n.size() > MAX_NOTE) return #err("The note is longer than 500 characters");
      case null {};
    };
    switch (call.expires_at) {
      case (?e) if (Nat64.toNat(e) < nowNs()) return #err("This proposal expired at " # utc(e));
      case null {};
    };
    switch (hardRefusal(call.canister, call.method)) { case (?r) return #err(r); case null {} };
    let (e, builtin) = switch (lookup(call.canister, call.method)) {
      case (?x) x;
      case null return #err(Principal.toText(call.canister) # " " # call.method # " is not in the proxy allowlist");
    };
    if (not e.enabled) return #err(e.label_ # " (" # call.method # ") is disabled in the proxy allowlist");
    if (e.class_ != cls) {
      let f = classFunction(e.class_);
      return #err(e.label_ # " is a " # className(e.class_) # " action: propose it with GNSF " # Nat.toText(f.id) # " (" # f.target_method # "), not " # classFunction(cls).target_method);
    };
    if (call.arg.size() > e.max_arg_bytes) return #err("The argument is " # Nat.toText(call.arg.size()) # " bytes; " # e.label_ # " allows at most " # Nat.toText(e.max_arg_bytes));
    let name = switch (nameOf(call.canister)) {
      case (?n) n;
      case null return #err("The target canister " # Principal.toText(call.canister) # " has no name in the proxy allowlist");
    };
    #ok(e, builtin, name);
  };

  func validationText(cls : Class, call : ProxyCall, e : Entry, name : Text) : Text {
    let f = classFunction(cls);
    let argHex = hex(call.arg);
    let small = call.arg.size() <= HEX_SHOWN_UP_TO;
    var t = "Sneed proxy · " # topicTitle(cls) # " (GNSF " # Nat.toText(f.id) # ")\n";
    t #= "Action: " # e.label_ # "\n";
    t #= "Target: " # name # " (" # Principal.toText(call.canister) # ")\n";
    t #= "Method: " # call.method # "\n";
    t #= "Argument: " # Nat.toText(call.arg.size()) # " bytes, SHA-256 " # hex(sha256(call.arg)) # "\n";
    if (small) t #= "Argument (hex): " # argHex # "\n";
    t #= "Reply: " # (switch (e.reply) { case (#any) "any reply is success"; case (#result) "an err reply fails the proposal" }) # "\n";
    t #= "Expires: " # (switch (call.expires_at) { case (?x) utc(x) # " (" # Nat64.toText(x) # " ns)"; case null "never" }) # "\n";
    switch (call.note) { case (?n) t #= "Note: " # n # "\n"; case null {} };
    t #= "Payload hash: " # hex(payloadHash(call)) # "\n";
    t #= "Read the argument decoded: https://app.sneeddao.com/proxy/verify?c=" # Principal.toText(call.canister) # "&m=" # call.method # (if (small) "&a=" # argHex else "");
    t;
  };

  func validate(cls : Class, call : ProxyCall) : ValidationResult {
    switch (check(cls, call)) {
      case (#ok(e, _, name)) #Ok(validationText(cls, call, e, name));
      case (#err(r)) #Err(r);
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Execute (one method per topic)
  // ---------------------------------------------------------------------------------------------

  type Forward = { #reply : Blob; #rejected : (Text, Text); #unknown : Text };

  func codeName(c : Error.ErrorCode) : Text = switch c {
    case (#system_fatal) "system_fatal";
    case (#system_transient) "system_transient";
    case (#system_unknown) "system_unknown";
    case (#destination_invalid) "destination_invalid";
    case (#canister_reject) "canister_reject";
    case (#canister_error) "canister_error";
    case (#future(n)) "future " # Nat32.toText(n);
    case (#call_error(e)) "call_error " # debug_show (e.err_code);
  };

  func record(f : Forwarded) {
    recent[recent_count % RECENT_CAPACITY] := ?f;
    recent_count += 1;
    let i = classIndex(f.class_);
    let (fw, ok, err, unk) = stats[i];
    stats[i] := switch (f.outcome) {
      case (#ok) (fw + 1, ok + 1, err, unk);
      case (#err) (fw + 1, ok, err + 1, unk);
      case (#unknown) (fw + 1, ok, err, unk + 1);
    };
  };

  func execute(cls : Class, caller : Principal, call : ProxyCall) : async* Text {
    if (caller != governance) Debug.trap("Only Sneed SNS governance may call the proxy's execute methods");
    let (e, _, _) = switch (check(cls, call)) {
      case (#ok(x)) x;
      case (#err(r)) Debug.trap(r);
    };
    if (in_flight >= max_in_flight) Debug.trap("The proxy is busy (" # Nat.toText(in_flight) # " calls in flight); nothing was called, re-propose later");
    in_flight += 1;
    let forward : Forward = try {
      #reply(await (with timeout = Nat32.fromNat(FORWARD_TIMEOUT)) IC.call(call.canister, call.method, call.arg));
    } catch (err) {
      switch (Error.code(err)) {
        case (#system_unknown) #unknown(Error.message(err));
        case (c) #rejected(codeName(c), Error.message(err));
      };
    } finally {
      in_flight -= 1;
    };

    let f = classFunction(cls);
    var outcome : T.Outcome = #ok;
    var error : ?Text = null;
    var reply : ?Blob = null;
    switch (forward) {
      case (#reply(bytes)) {
        reply := ?bytes;
        if (e.reply == #result) switch (CandidReply.classify(bytes)) {
          case (#ok) {};
          case (#err(?m)) { outcome := #err; error := ?clip(m, MAX_ERROR) };
          case (#err(null)) { outcome := #err; error := ?("target replied err (" # Nat.toText(bytes.size()) # " bytes)") };
        };
      };
      case (#rejected(code, m)) {
        outcome := #err;
        error := ?("target rejected (" # code # "): " # clip(m, MAX_ERROR));
      };
      case (#unknown(m)) {
        outcome := #unknown;
        error := ?("outcome unknown after " # Nat.toText(FORWARD_TIMEOUT) # " s: check " # Principal.toText(call.canister) # " state before re-proposing (" # clip(m, 200) # ")");
      };
    };

    let arg_hash = sha256(call.arg);
    let payload_hash = payloadHash(call);
    let reply_hash = switch (reply) { case (?b) ?sha256(b); case null null };
    let tx = Buffer.Buffer<(Text, T3.Value)>(16);
    tx.add(("function_id", #Nat(f.id)));
    tx.add(("class", #Text(className(cls))));
    tx.add(("target", pv(call.canister)));
    tx.add(("method", #Text(call.method)));
    tx.add(("label", #Text(e.label_)));
    tx.add(("arg_size", #Nat(call.arg.size())));
    tx.add(("arg_hash", #Blob(arg_hash)));
    tx.add(("payload_hash", #Blob(payload_hash)));
    switch (call.note) { case (?n) tx.add(("note", #Text(n))); case null {} };
    switch (call.expires_at) { case (?x) tx.add(("expires_at", #Nat(Nat64.toNat(x)))); case null {} };
    tx.add(("outcome", #Text(switch outcome { case (#ok) "ok"; case (#err) "err"; case (#unknown) "unknown" })));
    switch (error) { case (?m) tx.add(("error", #Text(m))); case null {} };
    switch (reply, reply_hash) {
      case (?b, ?h) {
        tx.add(("reply_size", #Nat(b.size())));
        tx.add(("reply_hash", #Blob(h)));
        if (b.size() <= REPLY_LOGGED_UP_TO) tx.add(("reply", #Blob(b)));
      };
      case _ {};
    };
    let index = block("forwarded", caller, Buffer.toArray(tx));
    record({
      block = index;
      ts = now64();
      function_id = f.id;
      class_ = cls;
      target = call.canister;
      method = call.method;
      label_ = e.label_;
      arg_size = call.arg.size();
      arg_hash;
      payload_hash;
      note = call.note;
      outcome;
      error;
      reply_size = switch (reply) { case (?b) ?b.size(); case null null };
      reply_hash;
    });

    switch (outcome, error) {
      case (#ok, _) {
        let n = switch (reply) { case (?b) b.size(); case null 0 };
        "ok: " # e.label_ # " · reply " # Nat.toText(n) # " bytes, SHA-256 " # (switch (reply_hash) { case (?h) hex(h); case null "" }) # " · block " # Nat.toText(index);
      };
      // a throw after the await commits this message's state (the block above) and still rejects
      // the call, so governance marks the proposal failed with this text (spec §3.5)
      case (_, ?m) throw Error.reject(m # " · block " # Nat.toText(index));
      case (_, null) throw Error.reject("failed · block " # Nat.toText(index));
    };
  };

  /// GNSF 6000 (ApplicationBusinessLogic): prices, fees, limits, texts, catalogue entries.
  public shared ({ caller }) func execute_business(call : ProxyCall) : async Text { await* execute(#business, caller, call) };
  /// GNSF 6001 (DappCanisterManagement): maintenance with no change of power or money.
  public shared ({ caller }) func execute_dapp(call : ProxyCall) : async Text { await* execute(#dapp, caller, call) };
  /// GNSF 6002 (DaoCommunitySettings, critical): reserved.
  public shared ({ caller }) func execute_community(call : ProxyCall) : async Text { await* execute(#community, caller, call) };
  /// GNSF 6003 (CriticalDappOperations, critical): admin lists, wiring, versions.
  public shared ({ caller }) func execute_critical(call : ProxyCall) : async Text { await* execute(#critical, caller, call) };
  /// GNSF 6004 (TreasuryAssetManagement, critical): fee destinations and money moving.
  public shared ({ caller }) func execute_treasury(call : ProxyCall) : async Text { await* execute(#treasury, caller, call) };

  public query func validate_business(call : ProxyCall) : async ValidationResult { validate(#business, call) };
  public query func validate_dapp(call : ProxyCall) : async ValidationResult { validate(#dapp, call) };
  public query func validate_community(call : ProxyCall) : async ValidationResult { validate(#community, call) };
  public query func validate_critical(call : ProxyCall) : async ValidationResult { validate(#critical, call) };
  public query func validate_treasury(call : ProxyCall) : async ValidationResult { validate(#treasury, call) };

  // ---------------------------------------------------------------------------------------------
  // Allowlist (GNSF 6010, critical)
  // ---------------------------------------------------------------------------------------------

  func entryText(e : Entry) : Text {
    "class " # className(e.class_) # " · \"" # e.label_ # "\" · max " # Nat.toText(e.max_arg_bytes) # " bytes · reply " # replyName(e.reply) # " · " # (if (e.enabled) "enabled" else "disabled");
  };

  func targetText(c : Principal, newNames : [CanisterName]) : Text {
    let n = switch (Array.find<CanisterName>(newNames, func(x) = x.canister == c)) {
      case (?x) ?x.name;
      case null nameOf(c);
    };
    switch (n) { case (?t) t # " (" # Principal.toText(c) # ")"; case null Principal.toText(c) };
  };

  /// The complete diff of an update as text, or why it is refused.
  func checkUpdate(u : AllowlistUpdate) : { #ok : Text; #err : Text } {
    if (u.upsert.size() + u.remove.size() + u.names.size() + u.remove_names.size() == 0) return #err("The update changes nothing");
    if (u.upsert.size() > MAX_UPDATE_ITEMS or u.remove.size() > MAX_UPDATE_ITEMS or u.names.size() > MAX_UPDATE_ITEMS or u.remove_names.size() > MAX_UPDATE_ITEMS) {
      return #err("At most 100 items per list in one update");
    };
    let lines = Buffer.Buffer<Text>(16);
    lines.add("Sneed proxy · allowlist change (GNSF 6010, Critical Dapp Operations)");

    // names first, so entries can refer to names given in the same update
    let seenNames = Buffer.Buffer<Principal>(4);
    for (n in u.names.vals()) {
      if (n.name.size() == 0 or n.name.size() > MAX_NAME) return #err("Canister names must be 1-64 characters");
      if (not isCanisterId(n.canister)) return #err(Principal.toText(n.canister) # " is not a canister id");
      if (n.canister == self()) return #err("The proxy's own name is fixed");
      if (Buffer.contains<Principal>(seenNames, n.canister, Principal.equal)) return #err("Duplicate name for " # Principal.toText(n.canister));
      seenNames.add(n.canister);
      switch (Map.get(names, Map.phash, n.canister)) {
        case (?old) if (old != n.name) lines.add("Rename: " # Principal.toText(n.canister) # " \"" # old # "\" → \"" # n.name # "\"") else lines.add("Name (unchanged): " # Principal.toText(n.canister) # " \"" # n.name # "\"");
        case null lines.add("Name: " # Principal.toText(n.canister) # " → \"" # n.name # "\"");
      };
    };
    for (c in u.remove_names.vals()) {
      if (Buffer.contains<Principal>(seenNames, c, Principal.equal)) return #err("A canister is both named and unnamed: " # Principal.toText(c));
      switch (Map.get(names, Map.phash, c)) {
        case (?old) lines.add("Remove name: " # Principal.toText(c) # " (was \"" # old # "\")");
        case null return #err(Principal.toText(c) # " has no name to remove");
      };
    };

    let seenKeys = Buffer.Buffer<(Principal, Text)>(8);
    func seen(k : (Principal, Text)) : Bool = Buffer.forSome<(Principal, Text)>(seenKeys, func(x) = x.0 == k.0 and x.1 == k.1);

    for ((c, m) in u.remove.vals()) {
      if (seen((c, m))) return #err("Duplicate removal of " # m);
      seenKeys.add((c, m));
      switch (Map.get(entries, pthash, (c, m))) {
        case (?old) lines.add("Remove: " # targetText(c, u.names) # " " # m # " (was " # entryText(old) # ")");
        case null return #err(Principal.toText(c) # " " # m # " is not in the allowlist");
      };
    };

    for (e in u.upsert.vals()) {
      if (seen((e.canister, e.method))) return #err("The update lists " # e.method # " twice");
      seenKeys.add((e.canister, e.method));
      switch (hardRefusal(e.canister, e.method)) { case (?r) return #err(r); case null {} };
      if (e.canister == self()) return #err("The proxy's own self_* entries are built in and cannot be changed");
      if (not isCanisterId(e.canister)) return #err(Principal.toText(e.canister) # " is not a canister id");
      if (e.method.size() == 0 or e.method.size() > MAX_METHOD) return #err("Method names must be 1-100 characters");
      if (e.label_.size() == 0 or e.label_.size() > MAX_LABEL) return #err("Labels must be 1-200 characters");
      if (e.max_arg_bytes == 0 or e.max_arg_bytes > MAX_ARG_CAP) return #err("max_arg_bytes must be 1-65536");
      // the target must have a name once this update is applied
      let named = Buffer.contains<Principal>(seenNames, e.canister, Principal.equal) or (Map.has(names, Map.phash, e.canister) and Array.find<Principal>(u.remove_names, func(c) = c == e.canister) == null);
      if (not named) return #err("Give " # Principal.toText(e.canister) # " a name in the same update (names)");
      switch (Map.get(entries, pthash, (e.canister, e.method))) {
        case (?old) {
          let changes = Buffer.Buffer<Text>(4);
          if (old.class_ != e.class_) changes.add("class " # className(old.class_) # " → " # className(e.class_));
          if (old.label_ != e.label_) changes.add("label \"" # old.label_ # "\" → \"" # e.label_ # "\"");
          if (old.max_arg_bytes != e.max_arg_bytes) changes.add("max " # Nat.toText(old.max_arg_bytes) # " → " # Nat.toText(e.max_arg_bytes) # " bytes");
          if (old.reply != e.reply) changes.add("reply " # replyName(old.reply) # " → " # replyName(e.reply));
          if (old.enabled != e.enabled) changes.add(if (e.enabled) "enabled" else "disabled");
          lines.add("Change: " # targetText(e.canister, u.names) # " " # e.method # ": " # (if (changes.size() == 0) "no change" else Text.join("; ", changes.vals())));
        };
        case null lines.add("Add: " # targetText(e.canister, u.names) # " " # e.method # " · " # entryText(e));
      };
    };

    // a name may not be removed while an entry (after this update) still uses it
    for (c in u.remove_names.vals()) {
      let usedByNew = Array.find<Entry>(u.upsert, func(e) = e.canister == c) != null;
      var usedByOld = false;
      for (((ec, em), _) in Map.entries(entries)) {
        if (ec == c and Array.find<(Principal, Text)>(u.remove, func(r) = r.0 == ec and r.1 == em) == null) usedByOld := true;
      };
      if (usedByNew or usedByOld) return #err("The name of " # Principal.toText(c) # " is still used by allowlist entries");
    };
    #ok(Text.join("\n", lines.vals()));
  };

  public query func validate_set_allowlist(u : AllowlistUpdate) : async ValidationResult {
    switch (checkUpdate(u)) { case (#ok(t)) #Ok(t); case (#err(e)) #Err(e) };
  };

  /// GNSF 6010 (CriticalDappOperations, critical): the only way the allowlist changes.
  public shared ({ caller }) func set_allowlist(u : AllowlistUpdate) : async Text {
    if (caller != governance) Debug.trap("Only Sneed SNS governance may change the proxy allowlist");
    let diff = switch (checkUpdate(u)) { case (#ok(t)) t; case (#err(e)) Debug.trap(e) };
    for (n in u.names.vals()) {
      Map.set(names, Map.phash, n.canister, n.name);
      ignore block("canister_named", caller, [("target", pv(n.canister)), ("name", #Text(n.name))]);
    };
    for ((c, m) in u.remove.vals()) {
      switch (Map.remove(entries, pthash, (c, m))) {
        case (?old) ignore block("allowlist_removed", caller, [("target", pv(c)), ("method", #Text(m)), ("old_class", #Text(className(old.class_)))]);
        case null {};
      };
    };
    for (e in u.upsert.vals()) {
      let old = Map.get(entries, pthash, (e.canister, e.method));
      Map.set(entries, pthash, (e.canister, e.method), e);
      let tx = Buffer.Buffer<(Text, T3.Value)>(8);
      tx.add(("target", pv(e.canister)));
      tx.add(("method", #Text(e.method)));
      tx.add(("class", #Text(className(e.class_))));
      tx.add(("label", #Text(e.label_)));
      tx.add(("max_arg_bytes", #Nat(e.max_arg_bytes)));
      tx.add(("reply", #Text(replyName(e.reply))));
      tx.add(("enabled", #Nat(if (e.enabled) 1 else 0)));
      switch (old) { case (?o) tx.add(("old_class", #Text(className(o.class_)))); case null {} };
      ignore block("allowlist_set", caller, Buffer.toArray(tx));
    };
    for (c in u.remove_names.vals()) {
      Map.delete(names, Map.phash, c);
      ignore block("canister_named", caller, [("target", pv(c)), ("name", #Text(""))]);
    };
    diff;
  };

  // ---------------------------------------------------------------------------------------------
  // Built-in self entries (reached only through execute_dapp, as calls from the proxy itself)
  // ---------------------------------------------------------------------------------------------

  func requireSelf(caller : Principal) {
    if (caller != self()) Debug.trap("Only the proxy itself (through an execute_dapp proposal)");
  };

  func configBlock(key : Text, old : Nat, new : Nat) {
    ignore block("config", self(), [("key", #Text(key)), ("old", #Nat(old)), ("new", #Nat(new))]);
  };

  public shared ({ caller }) func self_set_icrc3_settings(u : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
    requireSelf(caller);
    switch (Icrc3Log.applySettings(icrc3, u)) {
      case (#Err(e)) #Err(e);
      case (#Ok(changes)) {
        for ((key, old, new) in changes.vals()) configBlock(key, old, new);
        #Ok(icrc3.settings);
      };
    };
  };

  public shared ({ caller }) func self_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
    requireSelf(caller);
    if (icrc3_rt.spilling) return #Err("A spill is already in progress");
    #Ok(await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true));
  };

  public shared ({ caller }) func self_icrc3_repair_archive_controllers() : async { #Ok : [(Principal, { #Ok; #Err : Text })]; #Err : Text } {
    requireSelf(caller);
    #Ok(await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env()));
  };

  public shared ({ caller }) func self_set_max_in_flight(n : Nat) : async { #Ok : Nat; #Err : Text } {
    requireSelf(caller);
    if (n < 1 or n > 100) return #Err("max_in_flight must be 1-100");
    let old = max_in_flight;
    max_in_flight := n;
    if (old != n) configBlock("max_in_flight", old, n);
    #Ok(n);
  };

  // ---------------------------------------------------------------------------------------------
  // SNS canister list (hard refusals), refreshed daily
  // ---------------------------------------------------------------------------------------------

  type Root = actor { list_sns_canisters : shared {} -> async T.ListSnsCanistersResponse };

  func refreshSnsCanisters() : async () {
    let cid = TextLog.correlationId(textlog);
    try {
      let r = await (with timeout = 60) (actor (Principal.toText(root)) : Root).list_sns_canisters({});
      let out = Buffer.Buffer<Principal>(8);
      for (p in [r.root, r.governance, r.ledger, r.index, r.swap].vals()) switch (p) { case (?x) out.add(x); case null {} };
      for (a in r.archives.vals()) out.add(a);
      sns_canisters := Buffer.toArray(out);
      sns_canisters_refreshed_at := ?now64();
      TextLog.add(textlog, #info, cid, self(), "SNS canisters refreshed: " # Nat.toText(out.size()));
    } catch (e) {
      TextLog.add(textlog, #error, cid, self(), "Could not read the SNS canisters from root: " # Error.message(e));
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------------------------

  func view(e : Entry, builtin : Bool) : EntryView = {
    canister = e.canister;
    method = e.method;
    class_ = e.class_;
    label_ = e.label_;
    max_arg_bytes = e.max_arg_bytes;
    reply = e.reply;
    enabled = e.enabled;
    builtin;
  };

  /// Every allowlist entry plus the built-in self entries (builtin = true).
  public query func get_allowlist() : async [EntryView] {
    let out = Buffer.Buffer<EntryView>(Map.size(entries) + BUILTINS.size());
    for (e in Map.vals(entries)) out.add(view(e, false));
    for ((m, l) in BUILTINS.vals()) out.add(view(builtinEntry(m, l), true));
    Buffer.toArray(out);
  };

  public query func get_canister_names() : async [CanisterName] {
    let out = Buffer.Buffer<CanisterName>(Map.size(names) + 1);
    for ((canister, name) in Map.entries(names)) out.add({ canister; name });
    out.add({ canister = self(); name = "Sneed proxy" });
    Buffer.toArray(out);
  };

  public query func get_config() : async Config {
    {
      governance;
      root;
      sns_canisters;
      sns_canisters_refreshed_at;
      max_in_flight;
      in_flight;
      forward_timeout_seconds = FORWARD_TIMEOUT;
      functions = FUNCTIONS;
    };
  };

  public query func get_stats() : async [ClassStats] {
    Array.map<Class, ClassStats>(CLASSES, func(c) {
      let (forwarded, ok, err, unknown) = stats[classIndex(c)];
      { class_ = c; forwarded; ok; err; unknown };
    });
  };

  /// The last n forwarded calls (at most 100), newest first.
  public query func get_recent(n : Nat) : async [Forwarded] {
    let take = Nat.min(Nat.min(n, 100), Nat.min(recent_count, RECENT_CAPACITY));
    Array.tabulate<Forwarded>(take, func(i) {
      switch (recent[(recent_count - 1 - i) % RECENT_CAPACITY]) {
        case (?f) f;
        case null Debug.trap("unreachable");
      };
    });
  };

  /// The text log (spills, archives, SNS list refreshes). Public: nothing here is private.
  public query func get_log(start : Nat, length : Nat) : async [LogEntry] { TextLog.get(textlog, start, length) };

  // get_api_doc (ICP service discoverability): a short Markdown guide for agents and integrators,
  // with the full reference at https://app.sneeddao.com/api-docs/. A static text: no state read.
  public query func get_api_doc() : async Text { ApiDoc.text };

  // ---------------------------------------------------------------------------------------------
  // ICRC-3 interface
  // ---------------------------------------------------------------------------------------------

  public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult { Icrc3Log.getBlocks(icrc3, args) };
  public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult { Icrc3Log.getArchives(icrc3, args) };
  public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate { Icrc3Log.tipCertificate(icrc3) };
  public query func icrc3_supported_block_types() : async [T3.BlockType] { Icrc3Log.supportedBlockTypes(icrc3_catalogue) };
  public query func icrc10_supported_standards() : async [T3.SupportedStandard] { Icrc3Log.supportedStandards() };
  public query func icrc3_log_status() : async T3.LogStatus { Icrc3Log.status(icrc3, icrc3_rt) };

  // ---------------------------------------------------------------------------------------------
  // Timers (no heartbeat): the ICRC-3 spill check and the daily SNS canister refresh
  // ---------------------------------------------------------------------------------------------

  func icrc3_timer_job() : async () { ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false) };

  func ensure_timers<system>() {
    Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job);
    if (refresh_timers_started) return;
    refresh_timers_started := true;
    ignore Timer.setTimer<system>(#seconds 0, refreshSnsCanisters);
    ignore Timer.recurringTimer<system>(#seconds DAY_SECONDS, refreshSnsCanisters);
  };

  system func postupgrade() {
    Icrc3Log.certify(icrc3);
    ensure_timers<system>();
  };

  // ---------------------------------------------------------------------------------------------
  // Ingress guard (src/IngressGuard.mo): the proxy has no ingress update method at all.
  // ---------------------------------------------------------------------------------------------

  system func inspect({ msg : {
    #execute_business : Any;
    #execute_community : Any;
    #execute_critical : Any;
    #execute_dapp : Any;
    #execute_treasury : Any;
    #get_allowlist : Any;
    #get_api_doc : Any;
    #get_canister_names : Any;
    #get_config : Any;
    #get_log : Any;
    #get_recent : Any;
    #get_stats : Any;
    #icrc10_supported_standards : Any;
    #icrc3_get_archives : Any;
    #icrc3_get_blocks : Any;
    #icrc3_get_tip_certificate : Any;
    #icrc3_log_status : Any;
    #icrc3_supported_block_types : Any;
    #self_icrc3_repair_archive_controllers : Any;
    #self_icrc3_spill_now : Any;
    #self_set_icrc3_settings : Any;
    #self_set_max_in_flight : Any;
    #set_allowlist : Any;
    #validate_business : Any;
    #validate_community : Any;
    #validate_critical : Any;
    #validate_dapp : Any;
    #validate_set_allowlist : Any;
    #validate_treasury : Any;
  } }) : Bool {
    switch msg {
      // only SNS governance calls these, always inter-canister
      case (#execute_business _ or #execute_community _ or #execute_critical _ or #execute_dapp _ or #execute_treasury _ or #set_allowlist _) false;
      // only the proxy calls these, on itself
      case (#self_icrc3_repair_archive_controllers _ or #self_icrc3_spill_now _ or #self_set_icrc3_settings _ or #self_set_max_in_flight _) false;
      // queries (validators included) are free as queries; as updates the canister would pay
      case (#get_allowlist _ or #get_api_doc _ or #get_canister_names _ or #get_config _ or #get_log _ or #get_recent _ or #get_stats _ or #icrc10_supported_standards _ or #icrc3_get_archives _ or #icrc3_get_blocks _ or #icrc3_get_tip_certificate _ or #icrc3_log_status _ or #icrc3_supported_block_types _ or #validate_business _ or #validate_community _ or #validate_critical _ or #validate_dapp _ or #validate_set_allowlist _ or #validate_treasury _) false;
    };
  };

  ensure_timers<system>();
};
