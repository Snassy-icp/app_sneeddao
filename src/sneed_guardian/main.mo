/// sneed_guardian: a custody canister that is the controller of ledger-suite
/// canisters (ledger, index, archives) on behalf of one or more DAOs.
///
/// Deployed three ways from this one codebase (spec/custody.md): under SNS
/// root control as `sneed_guardian`, blackholed with Sneed governance as the
/// only approver as `sneed_guardian_blackhole`, and blackholed with several DAOs' governance
/// canisters as `sneed_guardian_multidao`. Nothing here depends on having a controller:
/// every change to a child is an "op" that the approvers approve (by DAO
/// proposal, through a generic nervous system function), that the child's
/// guardians may veto or must ok, and that anyone may then execute.
///
/// Hard rules that make the blackholed deployments safe to run forever:
/// - a child only ever runs a hash the NNS blessed for its kind, and only moves
///   one step along the blessed list at a time, in upgrade mode;
/// - the guardian never removes a controller the registrant kept, and only a
///   current controller of a canister can register it;
/// - nothing is an admin; the controllers of the `sneed_guardian` deployment
///   can only point tests at mock canisters and poke the timers.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Cycles "mo:base/ExperimentalCycles";
import Error "mo:base/Error";
import Int "mo:base/Int";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Timer "mo:base/Timer";
import Sha256 "mo:sha2/Sha256";
import PremiumClient "../PremiumClient";
import IngressGuard "../IngressGuard";
import RateLimit "../RateLimit";
import RateRules "../RateRules";

import T "Types";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import SP "../SpecialPrices";
import Map "mo:map/Map";
import { phash; nhash } "mo:map/Map";

shared ({ caller = installer }) persistent actor class SneedGuardian(init : T.Init) = this {
  transient let ICP_LEDGER_ID = "ryjl3-tyaaa-aaaaa-aaaba-cai";
  transient let SNS_WASM_ID = "qaa6y-5yaaa-aaaaa-aaafa-cai";
  transient let RLL_ID = "lvc4n-7aaaa-aaaam-adm6a-cai";
  transient let ICP_FEE : Nat = 10_000;
  transient let T_CYCLES : Nat = 1_000_000_000_000;
  transient let DAY_NS : Int = 86_400 * 1_000_000_000;
  transient let MAX_GUARDIANS = 20;
  transient let MAX_WINDOW_NS : Nat = 90 * 86_400 * 1_000_000_000;
  transient let STATUS_MIN_GAP_NS : Int = 60 * 1_000_000_000; // anyone may force a status read, this often
  transient let BLESSED_MIN_GAP_NS : Int = 10 * 60 * 1_000_000_000;

  // ---- configuration (install-time, then ops) ----
  stable var name : Text = init.name;
  stable var approvers : [Principal] = init.approvers;
  stable var threshold : Nat = init.threshold;
  stable var archive_controllers : [Principal] = init.archive_controllers;
  // Admins stand in for the DAO while a deployment is being tried out: they approve ops on their
  // own and run the timers. The list only shrinks by its own members' hand and cannot be refilled
  // once empty, so a matured deployment ends up with nobody above the approvers.
  stable var admins : [Principal] = init.admins;
  // The id of the DAO's generic nervous system function that calls approve_op, once registered;
  // the frontend files approval proposals with it.
  stable var approve_function_id : ?Nat64 = null;
  stable var sneed_premium_id : ?Principal = init.sneed_premium;
  stable var premium_cache = PremiumClient.emptyCache();
  stable var icp_ledger_id : Principal = switch (init.icp_ledger) { case (?p) { p }; case null { Principal.fromText(ICP_LEDGER_ID) } };
  stable var sns_wasm_id : Principal = switch (init.sns_wasm) { case (?p) { p }; case null { Principal.fromText(SNS_WASM_ID) } };
  stable var fee_destination : T.Account = switch (init.fee_destination) { case (?a) { a }; case null { { owner = Principal.fromText(RLL_ID); subaccount = null } } };
  stable var op_fee_e8s : Nat = 100_000_000; // 1 ICP
  stable var premium_op_fee_e8s : Nat = 50_000_000;
  // Special prices (spec/special_prices.md): the admin price (admins who are people) and partner
  // prices (per principal, public label, optional expiry). The lowest applicable op fee is charged.
  stable var admin_prices : T.Prices = { op_fee_e8s = null };
  stable var partner_prices = Map.new<Principal, SP.Partner<T.Prices>>();
  // the tier each op's fee was set at (Op keeps its type), by op id
  stable var op_price_tiers = Map.new<Nat, T.Tier>();
  stable var op_ttl_ns : Nat = 30 * 86_400 * 1_000_000_000;
  stable var self_window_ns : Nat = 0;
  stable var status_interval_s : Nat = 6 * 3600;
  stable var low_cycles_threshold : Nat = 2 * T_CYCLES;
  stable var cycle_reserve : Nat = 2 * T_CYCLES;
  stable var paused : Bool = false;

  // ---- state ----
  stable var children : [T.Child] = [];
  stable var ops : [T.Op] = [];
  stable var next_op_id : Nat = 1;
  // ---- anti-spam (spec/paging_audit.md S12): staging an op is free, so it is capped ----
  // open (pending or approved) ops one principal may have staged at once; admins are not limited
  stable var max_open_ops_per_caller : Nat = 10;
  // SHA-256 of each staged install's upgrade argument, by op id, so the lists show it without the bytes
  stable var op_arg_hashes = Map.new<Nat, Blob>();
  // per-caller rate limits (src/RateLimit.mo): admin overrides of RATE_DEFAULTS
  stable var rate_rules : [(Text, RateLimit.Rule)] = [];
  transient let limiter = RateLimit.Limiter();
  transient let RATE_DEFAULTS : RateRules.Rules = [
    ("stage_op", { capacity = 20; per_minute = 10 }),
    ("register", { capacity = 10; per_minute = 5 }),
    ("refund_op", { capacity = 20; per_minute = 10 }),
  ];
  private func rateRule(action : Text) : RateLimit.Rule { RateRules.rule(rate_rules, RATE_DEFAULTS, action) };
  /// Takes one call of `action` for a non-admin caller; false when its bucket is empty.
  private func rateTake(caller : Principal, action : Text) : Bool { isAdmin(caller) or limiter.take(caller, action, rateRule(action), Time.now()) };
  private func rateAllows(caller : Principal, action : Text) : Bool { isAdmin(caller) or limiter.allows(caller, action, rateRule(action), Time.now()) };
  private func rateLimited(action : Text) : Text { "Rate limited: too many " # action # " calls; try again in a minute" };
  // an install's upgrade argument: generous for ledger upgrade args (metadata with a logo), far below 1 MiB
  transient let MAX_INSTALL_ARG : Nat = 262_144;
  transient let DEFAULT_PAGE : Nat = 50;
  transient let MAX_PAGE : Nat = 100;
  // the old list_ops / list_ops_for return whole ops: stop adding install args past this many bytes
  transient let LIST_ARG_BUDGET : Nat = 1_500_000;
  stable var blessed_ledger : [Blob] = [];
  stable var blessed_index : [Blob] = [];
  stable var blessed_archive : [Blob] = [];
  stable var blessed_at : Int = 0;
  stable var blessed_last_check : Int = 0;
  stable var blessed_error : ?Text = null;
  stable var status_last_run : Int = 0;
  stable var status_last_forced : Int = 0;
  stable var next_correlation_id : Nat = 1;
  transient var timers_started : Bool = false;
  transient var status_running : Bool = false;
  transient var upgrade_running : Bool = false;
  transient var blessed_running : Bool = false;
  // Ops whose execute_op is in flight (between its first await and its last state write). Every
  // await is a commit point, so without this a second execute_op of the same op could run the action
  // (and sweep the fee) again; cancel and veto wait for the outcome too. Transient on purpose: an
  // upgrade stops the canister first, and a call cut short by an upgrade must not stay marked.
  transient var executing : [Nat] = [];
  private func isExecuting(id : Nat) : Bool { Array.find<Nat>(executing, func(x) { x == id }) != null };

  transient let ic : T.Management = actor ("aaaaa-aa");
  private func icp_ledger() : T.IcpLedger { actor (Principal.toText(icp_ledger_id)) };
  private func sns_wasm() : T.SnsWasmCanister { actor (Principal.toText(sns_wasm_id)) };
  private func self() : Principal { Principal.fromActor(this) };
  private func newCid() : Nat { let c = next_correlation_id; next_correlation_id += 1; c };

  // ---- text log (last 500 lines) ----
  stable var text_log : [Text] = [];
  private func logText(cid : Nat, level : Text, m : Text) {
    let line = Int.toText(Time.now()) # " [" # Nat.toText(cid) # "] " # level # " " # m;
    let b = Buffer.fromArray<Text>(text_log);
    b.add(line);
    while (b.size() > 500) { ignore b.remove(0) };
    text_log := Buffer.toArray(b);
  };

  // ---- ICRC-3 log ----
  stable var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/sneed_guardian#block-types";
    block_types = ["guardian_register", "guardian_release", "guardian_op_stage", "guardian_op_approve", "guardian_op_ok", "guardian_op_veto", "guardian_op_execute", "guardian_op_fail", "guardian_op_cancel", "guardian_op_fee", "guardian_op_refund", "guardian_upgrade", "guardian_config_update", "guardian_approvers_set", "guardian_policy_set"];
  };
  private func icrc3_env() : Icrc3Log.Environment {
    {
      self = self();
      archive_controllers = archive_controllers;
      cycle_reserve = cycle_reserve;
      new_correlation_id = newCid;
      log_info = func(cid : Nat, m : Text) { logText(cid, "info", m) };
      log_error = func(cid : Nat, m : Text) { logText(cid, "error", m) };
    };
  };
  private func icrc3_add(btype : Text, tx : [(Text, T3.Value)]) { ignore Icrc3Log.append(icrc3, btype, Int.abs(Time.now()), tx) };
  private func icrc3_timer_job() : async () { ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false) };
  private func pv(p : Principal) : T3.Value { Icrc3Log.principal(p) };
  private func plist(ps : [Principal]) : T3.Value { #Array(Array.map<Principal, T3.Value>(ps, pv)) };

  // ---- helpers ----
  private func sha256(b : Blob) : Blob { Sha256.fromBlob(#sha256, b) };
  private func hex(b : Blob) : Text {
    let chars = Iter.toArray("0123456789abcdef".chars());
    var out = "";
    for (byte in b.vals()) { let n = Nat8.toNat(byte); out #= Text.fromChar(chars[n / 16]) # Text.fromChar(chars[n % 16]) };
    out;
  };
  private func kindText(k : T.Kind) : Text { switch (k) { case (#ledger) { "ledger" }; case (#index) { "index" }; case (#archive) { "archive" } } };
  private func has(ps : [Principal], p : Principal) : Bool { Array.find<Principal>(ps, func(x) { x == p }) != null };
  private func findChild(id : Principal) : ?T.Child { Array.find<T.Child>(children, func(c) { c.canister_id == id }) };
  private func putChild(c : T.Child) {
    if (findChild(c.canister_id) == null) { children := Array.append(children, [c]) }
    else { children := Array.map<T.Child, T.Child>(children, func(x) { if (x.canister_id == c.canister_id) { c } else { x } }) };
  };
  private func dropChild(id : Principal) { children := Array.filter<T.Child>(children, func(c) { c.canister_id != id }) };
  private func findOp(id : Nat) : ?T.Op { Array.find<T.Op>(ops, func(o) { o.id == id }) };
  private func putOp(o : T.Op) { ops := Array.map<T.Op, T.Op>(ops, func(x) { if (x.id == o.id) { o } else { x } }) };
  private func isApprover(p : Principal) : Bool { has(approvers, p) };
  /// Admins: the listed principals, plus controllers (SNS root for the `sneed_guardian`
  /// deployment, a developer on staging, nobody once blackholed).
  private func isAdmin(p : Principal) : Bool { not Principal.isAnonymous(p) and (Principal.isController(p) or has(admins, p)) };
  private func blessedFor(k : T.Kind) : [Blob] { switch (k) { case (#ledger) { blessed_ledger }; case (#index) { blessed_index }; case (#archive) { blessed_archive } } };
  private func isBlessed(k : T.Kind, h : Blob) : Bool { Array.find<Blob>(blessedFor(k), func(x) { x == h }) != null };
  /// The hash after `current` on the blessed list of a kind, if `current` is on it and not last.
  private func nextBlessed(k : T.Kind, current : Blob) : ?Blob {
    let list = blessedFor(k);
    var i = 0;
    while (i < list.size()) {
      if (list[i] == current) { return if (i + 1 < list.size()) { ?list[i + 1] } else { null } };
      i += 1;
    };
    null;
  };
  private func validatePolicy(p : T.Policy) : ?Text {
    if (p.guardians.size() > MAX_GUARDIANS) { return ?("at most " # Nat.toText(MAX_GUARDIANS) # " guardians") };
    for (g in p.guardians.vals()) { if (Principal.isAnonymous(g)) { return ?"the anonymous principal cannot be a guardian" } };
    if (p.vetoes_to_block > p.guardians.size()) { return ?"vetoes_to_block cannot exceed the number of guardians" };
    if (p.oks_required > p.guardians.size()) { return ?"oks_required cannot exceed the number of guardians" };
    if (p.window_ns > MAX_WINDOW_NS) { return ?"the veto window is at most 90 days" };
    if (p.vetoes_to_block > 0 and p.window_ns == 0) { return ?"vetoes need a window to happen in: set window_ns" };
    null;
  };
  /// Policy for ops on the guardian itself: approvers decide, with the configured window.
  private func selfPolicy() : T.Policy { { guardians = []; vetoes_to_block = 0; oks_required = 0; window_ns = self_window_ns; auto_upgrade = false } };
  private func policyOf(op : T.Op) : T.Policy {
    if (op.child == self()) { return selfPolicy() };
    switch (findChild(op.child)) { case (?c) { c.policy }; case null { selfPolicy() } };
  };
  private func statusFrom(s : T.CanisterStatus) : T.Status {
    {
      at = Time.now(); cycles = s.cycles; memory_size = s.memory_size; module_hash = s.module_hash; controllers = s.settings.controllers;
      running = switch (s.status) { case (#running) { "running" }; case (#stopping) { "stopping" }; case (#stopped) { "stopped" } };
      idle_cycles_burned_per_day = s.idle_cycles_burned_per_day; freezing_threshold = s.settings.freezing_threshold; error = null;
    };
  };
  private func readStatus(id : Principal) : async* { #Ok : T.Status; #Err : Text } {
    try { #Ok(statusFrom(await ic.canister_status({ canister_id = id }))) }
    catch (e) { #Err("canister_status failed (is the guardian a controller of " # Principal.toText(id) # "?): " # Error.message(e)) };
  };
  private func refreshChildStatus(c : T.Child) : async* T.Child {
    switch (await* readStatus(c.canister_id)) {
      case (#Ok(s)) { let u = { c with status = ?s }; putChild(u); u };
      case (#Err(e)) {
        let prev = switch (c.status) { case (?s) { s }; case null { { at = 0; cycles = 0; memory_size = 0; module_hash = null; controllers = []; running = "unknown"; idle_cycles_burned_per_day = 0; freezing_threshold = 0; error = null } } };
        let u = { c with status = ?{ prev with error = ?e } }; putChild(u); u;
      };
    };
  };

  // ---- the blessed lists ----
  private func refreshBlessedImpl() : async* { #Ok : Nat; #Err : Text } {
    if (blessed_running) { return #Err("a refresh is already running") };
    blessed_running := true;
    blessed_last_check := Time.now();
    let r = try { #Ok(await sns_wasm().list_upgrade_steps({ limit = 500; starting_at = null; sns_governance_canister_id = null })) } catch (e) { #Err("SNS wasm canister: " # Error.message(e)) };
    blessed_running := false;
    switch (r) {
      case (#Err(e)) { blessed_error := ?e; logText(newCid(), "error", "blessed list: " # e); #Err(e) };
      case (#Ok(res)) {
        let l = Buffer.Buffer<Blob>(16); let i = Buffer.Buffer<Blob>(16); let a = Buffer.Buffer<Blob>(16);
        let add = func(b : Buffer.Buffer<Blob>, h : Blob) { if (h.size() == 32 and Buffer.indexOf<Blob>(h, b, Blob.equal) == null) { b.add(h) } };
        for (s in res.steps.vals()) { switch (s.version) { case (?v) { add(l, v.ledger_wasm_hash); add(i, v.index_wasm_hash); add(a, v.archive_wasm_hash) }; case null {} } };
        if (l.size() == 0) { blessed_error := ?"the SNS wasm canister listed no versions"; return #Err("the SNS wasm canister listed no versions") };
        blessed_ledger := Buffer.toArray(l); blessed_index := Buffer.toArray(i); blessed_archive := Buffer.toArray(a);
        blessed_at := Time.now(); blessed_error := null;
        #Ok(res.steps.size());
      };
    };
  };
  /// Re-read the NNS's blessed versions now (anyone, at most every ten minutes; the daily timer does it too).
  public shared ({ caller }) func refresh_blessed() : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller) and Time.now() - blessed_last_check < BLESSED_MIN_GAP_NS) { return #Err("checked recently; try again in a few minutes") };
    await* refreshBlessedImpl();
  };
  private func ensureBlessed() : async* () { if (blessed_ledger.size() == 0 or Time.now() - blessed_at > DAY_NS) { ignore await* refreshBlessedImpl() } };

  // ---- registration ----
  /// Put a canister the guardian already controls under its custody. The caller must be a current
  /// controller of it (proof of ownership) and its code must be a blessed hash of the kind.
  public shared ({ caller }) func register(canister_id : Principal, kind : T.Kind, policy : T.Policy, suite : ?Principal, title : Text) : async { #Ok : T.Child; #Err : Text } {
    if (paused) { return #Err("the guardian is paused") };
    if (Principal.isAnonymous(caller)) { return #Err("log in first") };
    if (title.size() > 64) { return #Err("title: at most 64 characters") };
    if (not rateTake(caller, "register")) { return #Err(rateLimited("register")) };
    switch (validatePolicy(policy)) { case (?e) { return #Err(e) }; case null {} };
    if (findChild(canister_id) != null) { return #Err("already registered") };
    if (canister_id == self()) { return #Err("the guardian cannot be its own child") };
    switch (suite) { case (?s) { if (kind == #ledger) { return #Err("a ledger has no suite; give suite for an index or archive") }; switch (findChild(s)) { case (?c) { if (c.kind != #ledger) { return #Err("suite must name a registered ledger") } }; case null { return #Err("suite must name a registered ledger") } } }; case null {} };
    await* ensureBlessed();
    let st = switch (await* readStatus(canister_id)) { case (#Ok(s)) { s }; case (#Err(e)) { return #Err("add the guardian (" # Principal.toText(self()) # ") as a controller first: " # e) } };
    if (not has(st.controllers, caller)) { return #Err("only a current controller of the canister can register it") };
    switch (st.module_hash) {
      case null { return #Err("the canister has no code installed") };
      case (?h) { if (not isBlessed(kind, h)) { return #Err("the canister's code (" # hex(h) # ") is not a version the NNS blessed for a " # kindText(kind) # "; the guardian only takes blessed ledger suites") } };
    };
    let c : T.Child = { canister_id; kind; suite; title; policy; registered_at = Time.now(); registered_by = caller; status = ?st; last_upgrade = null; last_upgrade_error = null };
    putChild(c);
    let cid = newCid();
    icrc3_add("guardian_register", [("cid", #Nat(cid)), ("caller", pv(caller)), ("canister", pv(canister_id)), ("kind", #Text(kindText(kind))), ("title", #Text(title)), ("guardians", plist(policy.guardians)), ("auto_upgrade", #Text(debug_show(policy.auto_upgrade)))]);
    logText(cid, "info", "registered " # kindText(kind) # " " # Principal.toText(canister_id) # " (" # title # ") by " # Principal.toText(caller));
    #Ok(c);
  };

  // ---- ops ----
  private func opKindText(k : T.OpKind) : Text {
    switch (k) {
      case (#set_controllers(ps)) { "set controllers to [" # Text.join(", ", Iter.map<Principal, Text>(ps.vals(), Principal.toText)) # "]" };
      case (#install(i)) { "upgrade to blessed hash " # hex(i.hash) };
      case (#set_policy(p)) { "set policy: " # Nat.toText(p.guardians.size()) # " guardians, " # Nat.toText(p.vetoes_to_block) # " vetoes block, " # Nat.toText(p.oks_required) # " oks required, window " # Nat.toText(p.window_ns / 1_000_000_000) # " s, auto-upgrade " # debug_show(p.auto_upgrade) };
      case (#set_config(_)) { "change the guardian's configuration" };
      case (#set_approvers(a)) { "set approvers to [" # Text.join(", ", Iter.map<Principal, Text>(a.approvers.vals(), Principal.toText)) # "] with threshold " # Nat.toText(a.threshold) };
    };
  };
  private func validateOp(child : Principal, kind : T.OpKind) : ?Text {
    let selfOp = child == self();
    switch (kind) {
      case (#set_config(_)) { if (not selfOp) { return ?"configuration ops target the guardian itself" } };
      case (#set_approvers(a)) {
        if (not selfOp) { return ?"approver ops target the guardian itself" };
        if (a.approvers.size() == 0) { return ?"at least one approver" };
        if (a.threshold == 0 or a.threshold > a.approvers.size()) { return ?"threshold must be between 1 and the number of approvers" };
        for (p in a.approvers.vals()) { if (Principal.isAnonymous(p)) { return ?"the anonymous principal cannot approve" } };
      };
      case (#set_controllers(ps)) {
        if (selfOp) { return ?"the guardian does not control itself" };
        if (ps.size() == 0) { return ?"give at least one controller (the guardian itself to keep custody)" };
        if (ps.size() > 10) { return ?"at most 10 controllers" };
        for (p in ps.vals()) { if (Principal.isAnonymous(p)) { return ?"the anonymous principal cannot be a controller" } };
      };
      case (#install(i)) {
        if (selfOp) { return ?"the guardian cannot install code on itself" };
        if (i.hash.size() != 32) { return ?"a wasm hash is 32 bytes" };
        switch (findChild(child)) {
          case null { return ?"not a registered child" };
          case (?c) { if (not isBlessed(c.kind, i.hash)) { return ?("not a hash the NNS blessed for a " # kindText(c.kind)) } };
        };
      };
      case (#set_policy(p)) { if (selfOp) { return ?"the guardian has no policy of its own" }; switch (validatePolicy(p)) { case (?e) { return ?e }; case null {} } };
    };
    if (not selfOp and findChild(child) == null) { return ?"not a registered child" };
    null;
  };
  /// Sneed Premium membership (cached by the shared client); never blocks when the membership canister is unreachable.
  private func isPremium(p : Principal) : async* Bool {
    switch (sneed_premium_id) { case (?id) { try { await* PremiumClient.isPremium(premium_cache, id, p) } catch (_) { false } }; case null { false } };
  };
  /// An op's payment subaccount: 'o', a version byte, and the op id big-endian in the last 8 bytes.
  private func opSubaccount(id : Nat) : Blob {
    var n = id;
    let a = Array.init<Nat8>(32, 0);
    a[0] := 0x6f; a[1] := 1;
    var i = 31;
    while (i >= 24) { a[i] := Nat8.fromNat(n % 256); n := n / 256; i -= 1 };
    Blob.fromArray(Array.freeze(a));
  };
  private func opAccount(id : Nat) : T.Account { { owner = self(); subaccount = ?opSubaccount(id) } };
  private func opBalance(id : Nat) : async* { #Ok : Nat; #Err : Text } {
    try { #Ok(await icp_ledger().icrc1_balance_of(opAccount(id))) } catch (e) { #Err("could not read the ICP ledger: " # Error.message(e)) };
  };
  /// Where to pay an op's fee, and what has been paid so far (the balance is read live).
  public shared func get_op_payment(id : Nat) : async { #Ok : T.OpPayment; #Err : Text } {
    let op = switch (findOp(id)) { case (?o) { o }; case null { return #Err("no op " # Nat.toText(id)) } };
    let bal = switch (await* opBalance(id)) { case (#Ok(b)) { b }; case (#Err(e)) { return #Err(e) } };
    #Ok({ account = opAccount(id); fee_e8s = op.fee_e8s; amount_to_send_e8s = if (op.fee_e8s == 0) { 0 } else { op.fee_e8s + ICP_FEE }; paid_e8s = bal + op.fee_paid_e8s + op.refunded_e8s; refunded_e8s = op.refunded_e8s });
  };
  /// Propose a change (anyone, free to stage). The op fee, if any, is paid afterwards by a plain
  /// transfer to the op's payment subaccount: the approval proposal cannot be filed until it is
  /// there, execution sweeps it to the fee destination, and a dead op's money is refundable to the
  /// payer. `payer` defaults to the caller; anyone may pay on the payer's behalf.
  public shared ({ caller }) func stage_op(child : Principal, kind : T.OpKind, memo : Text, payer : ?Principal) : async { #Ok : T.Op; #Err : Text } {
    if (paused) { return #Err("the guardian is paused") };
    if (Principal.isAnonymous(caller)) { return #Err("log in first") };
    if (memo.size() > 500) { return #Err("memo: at most 500 characters") };
    switch (kind) { case (#install(i)) { switch (i.arg) { case (?a) { if (a.size() > MAX_INSTALL_ARG) { return #Err("the upgrade argument is " # Nat.toText(a.size()) # " bytes; at most " # Nat.toText(MAX_INSTALL_ARG)) } }; case null {} } }; case _ {} };
    if (not isAdmin(caller)) {
      let open = openOpsOf(caller);
      if (open >= max_open_ops_per_caller) { return #Err("you have " # Nat.toText(open) # " open ops (at most " # Nat.toText(max_open_ops_per_caller) # "); cancel one or wait for them to close") };
    };
    if (not rateTake(caller, "stage_op")) { return #Err(rateLimited("stage_op")) };
    if (kind == #set_config({ op_fee_e8s = null; premium_op_fee_e8s = null; fee_destination = null; op_ttl_ns = null; self_window_ns = null; status_interval_s = null; low_cycles_threshold = null; cycle_reserve = null; paused = null; approve_function_id = null })) { return #Err("an empty configuration change") };
    switch (kind) { case (#install(_)) { await* ensureBlessed() }; case _ {} };
    switch (validateOp(child, kind)) { case (?e) { return #Err(e) }; case null {} };
    let who = switch (payer) { case (?p) { p }; case null { caller } };
    if (Principal.isAnonymous(who)) { return #Err("the payer cannot be the anonymous principal") };
    // the base fee exactly as before (members pay the premium fee); the admin or partner price when
    // lower, for the caller paying for itself (a named payer never lends its special price)
    let (fee, tier) : (Nat, T.Tier) = if (child == self()) { (0, #regular) } else {
      let premium = await* isPremium(who);
      let base = if (premium) { premium_op_fee_e8s } else { op_fee_e8s };
      let sp = if (who == caller) { specialFor(caller) } else { { admin = null; partner = null } };
      let (v, t) = SP.lowest(base, null, sp.admin, sp.partner);
      (v, if (premium and t == #regular) { #premium } else { t });
    };
    let op : T.Op = { id = next_op_id; child; kind; staged_by = caller; staged_at = Time.now(); memo; payer = who; fee_e8s = fee; fee_paid_e8s = 0; refunded_e8s = 0; approvals = []; oks = []; vetoes = []; state = #pending };
    next_op_id += 1;
    // re-check after the awaits above (other stages may have landed meanwhile)
    if (not isAdmin(caller) and openOpsOf(caller) >= max_open_ops_per_caller) { return #Err("you have too many open ops; cancel one or wait for them to close") };
    ops := Array.append(ops, [op]);
    Map.set(op_price_tiers, nhash, op.id, tier);
    switch (kind) { case (#install({ arg = ?a })) { Map.set(op_arg_hashes, nhash, op.id, sha256(a)) }; case _ {} };
    let cid = newCid();
    icrc3_add("guardian_op_stage", [("cid", #Nat(cid)), ("caller", pv(caller)), ("op", #Nat(op.id)), ("canister", pv(child)), ("what", #Text(opKindText(kind))), ("fee_e8s", #Nat(fee)), ("payer", pv(who)), ("memo", #Text(memo)), ("price_tier", #Text(SP.tierText(tier)))]);
    logText(cid, "info", "op " # Nat.toText(op.id) # " staged by " # Principal.toText(caller) # ": " # opKindText(kind) # " on " # Principal.toText(child));
    #Ok(op);
  };
  private func isOpen(o : T.Op) : Bool {
    switch (o.state) { case (#pending or #approved(_)) { Time.now() <= o.staged_at + op_ttl_ns }; case _ { false } };
  };
  /// The ops `p` staged that are still open (pending or approved, not expired).
  private func openOpsOf(p : Principal) : Nat {
    var n = 0;
    for (o in ops.vals()) { if (o.staged_by == p and isOpen(o)) { n += 1 } };
    n;
  };
  /// An op with the expiry applied (queries cannot write it back).
  private func viewOp(o : T.Op) : T.Op {
    if (Time.now() > o.staged_at + op_ttl_ns and (switch (o.state) { case (#pending or #approved(_)) { true }; case _ { false } })) { { o with state = #expired } } else { o };
  };
  private func argBytes(o : T.Op) : Nat { switch (o.kind) { case (#install({ arg = ?a })) { a.size() }; case _ { 0 } } };
  private func summaryOf(o0 : T.Op) : T.OpSummary {
    let o = viewOp(o0);
    let kind : T.OpKindSummary = switch (o.kind) {
      case (#set_controllers(ps)) { #set_controllers(ps) };
      case (#install(i)) {
        switch (i.arg) {
          case (?a) { #install({ hash = i.hash; arg_size = ?a.size(); arg_sha256 = ?(switch (Map.get(op_arg_hashes, nhash, o.id)) { case (?h) { h }; case null { sha256(a) } }) }) };
          case null { #install({ hash = i.hash; arg_size = null; arg_sha256 = null }) };
        };
      };
      case (#set_policy(p)) { #set_policy(p) };
      case (#set_config(c)) { #set_config(c) };
      case (#set_approvers(a)) { #set_approvers(a) };
    };
    {
      id = o.id; child = o.child; kind; staged_by = o.staged_by; staged_at = o.staged_at; memo = o.memo; payer = o.payer;
      fee_e8s = o.fee_e8s; fee_paid_e8s = o.fee_paid_e8s; refunded_e8s = o.refunded_e8s; approvals = o.approvals; oks = o.oks; vetoes = o.vetoes; state = o.state;
    };
  };
  /// Newest first: the ops (by `keep`) below `before`, at most `limit`, and whole ops (with their
  /// install arguments) only until LIST_ARG_BUDGET bytes of arguments are reached.
  private func pickOps(keep : (T.Op) -> Bool, before : ?Nat, limit : Nat, budget : Bool) : ([T.Op], ?Nat) {
    let out = Buffer.Buffer<T.Op>(limit);
    var bytes = 0;
    var i = ops.size();
    var next : ?Nat = null;
    label scan while (i > 0) {
      i -= 1;
      let o = viewOp(ops[i]);
      switch (before) { case (?b) { if (o.id >= b) { continue scan } }; case null {} };
      if (not keep(o)) { continue scan };
      if (out.size() >= limit or (budget and out.size() > 0 and bytes + argBytes(o) > LIST_ARG_BUDGET)) {
        next := ?(out.get(out.size() - 1).id);
        break scan;
      };
      bytes += argBytes(o);
      out.add(o);
    };
    (Buffer.toArray(out), next);
  };
  private func pageLimit(limit : Nat) : Nat { if (limit == 0) { DEFAULT_PAGE } else { Nat.min(limit, MAX_PAGE) } };
  private func openKeep(o : T.Op) : Bool { switch (o.state) { case (#pending or #approved(_)) { true }; case _ { false } } };

  /// The op as it stands now: pending and approved ops expire after the ttl.
  private func current(op : T.Op) : T.Op {
    switch (op.state) {
      case (#pending or #approved(_)) { if (Time.now() > op.staged_at + op_ttl_ns) { let u = { op with state = #expired }; putOp(u); u } else { op } };
      case _ { op };
    };
  };
  private func describeOp(op : T.Op) : Text {
    let who = if (op.child == self()) { name # " itself" } else { switch (findChild(op.child)) { case (?c) { c.title # " (" # kindText(c.kind) # " " # Principal.toText(c.canister_id) # ")" }; case null { Principal.toText(op.child) } } };
    let pol = policyOf(op);
    "Op #" # Nat.toText(op.id) # " on " # who # ": " # opKindText(op.kind) # ".\n"
    # "Staged by " # Principal.toText(op.staged_by) # (if (op.memo != "") { " with memo: " # op.memo } else { "" }) # ".\n"
    # "Rules: " # Nat.toText(threshold) # " of " # Nat.toText(approvers.size()) # " approvers"
    # (if (pol.window_ns > 0) { ", then a " # Nat.toText(pol.window_ns / 3600_000_000_000) # " h window in which " # Nat.toText(pol.vetoes_to_block) # " of " # Nat.toText(pol.guardians.size()) # " guardians can veto" } else { "" })
    # (if (pol.oks_required > 0) { ", and " # Nat.toText(pol.oks_required) # " guardian go-aheads" } else { "" }) # ".\n"
    # "State: " # debug_show(op.state) # "; approvals " # Nat.toText(op.approvals.size()) # ", oks " # Nat.toText(op.oks.size()) # ", vetoes " # Nat.toText(op.vetoes.size()) # ".\n"
    # (if (op.fee_e8s > 0) { "Fee: " # Nat.toText(op.fee_e8s) # " e8s ICP, paid by " # Principal.toText(op.payer) # " into the op's payment account, swept to " # Principal.toText(fee_destination.owner) # " when the op executes." } else { "No fee." });
  };
  /// The proposal text for an `approve_op` generic function (its validator). Governance calls it
  /// when the proposal is filed; it refuses until the op's fee is in its payment account, so a
  /// proposal that would fail at execution for want of a fee never reaches the ballot.
  public shared func validate_approve_op(id : Nat) : async { #Ok : Text; #Err : Text } {
    let op = switch (findOp(id)) { case (?o) { current(o) }; case null { return #Err("no op " # Nat.toText(id)) } };
    switch (op.state) { case (#pending) {}; case (s) { return #Err("op " # Nat.toText(id) # " is " # debug_show(s) # ", not pending") } };
    if (op.fee_e8s > 0) {
      let bal = switch (await* opBalance(id)) { case (#Ok(b)) { b }; case (#Err(e)) { return #Err(e) } };
      if (bal < op.fee_e8s + ICP_FEE) { return #Err("the op's fee is not paid: send " # Nat.toText(op.fee_e8s + ICP_FEE) # " e8s ICP to the guardian's subaccount " # hex(opSubaccount(id)) # " (it holds " # Nat.toText(bal) # ")") };
    };
    #Ok(describeOp(op));
  };
  /// Return what is left in a dead op's payment account (or an executed op's surplus) to its payer.
  public shared ({ caller }) func refund_op(id : Nat) : async { #Ok : Nat; #Err : Text } {
    if (Principal.isAnonymous(caller)) { return #Err("log in first") };
    if (not rateTake(caller, "refund_op")) { return #Err(rateLimited("refund_op")) };
    let op = switch (findOp(id)) { case (?o) { current(o) }; case null { return #Err("no op " # Nat.toText(id)) } };
    switch (op.state) { case (#pending or #approved(_)) { return #Err("the op is still open; cancel it first") }; case _ {} };
    let bal = switch (await* opBalance(id)) { case (#Ok(b)) { b }; case (#Err(e)) { return #Err(e) } };
    if (bal <= ICP_FEE) { return #Err("nothing to refund") };
    let amount = bal - ICP_FEE;
    let r = try { await icp_ledger().icrc1_transfer({ from_subaccount = ?opSubaccount(id); to = { owner = op.payer; subaccount = null }; amount; fee = ?ICP_FEE; memo = null; created_at_time = null }) } catch (e) { return #Err("refund failed: " # Error.message(e)) };
    switch (r) { case (#Err(e)) { return #Err("refund failed: " # debug_show(e)) }; case (#Ok(_)) {} };
    // re-read: the op record may have moved on across the awaits
    switch (findOp(id)) { case (?o) { putOp({ o with refunded_e8s = o.refunded_e8s + amount }) }; case null {} };
    icrc3_add("guardian_op_refund", [("cid", #Nat(newCid())), ("caller", pv(caller)), ("op", #Nat(id)), ("payer", pv(op.payer)), ("amount_e8s", #Nat(amount))]);
    #Ok(amount);
  };
  /// An approver (a DAO's governance canister, through a passed proposal) approves an op. An admin's
  /// approval counts as the whole threshold, so a deployment can be exercised without the DAO.
  public shared ({ caller }) func approve_op(id : Nat) : async { #Ok : T.Op; #Err : Text } {
    let admin = isAdmin(caller);
    if (not isApprover(caller) and not admin) { return #Err("only an approver can approve") };
    let op = switch (findOp(id)) { case (?o) { current(o) }; case null { return #Err("no op " # Nat.toText(id)) } };
    if (has(op.approvals, caller)) { return #Err("already approved by this approver") };
    if (op.state != #pending) { return #Err("op is " # debug_show(op.state) # ", not pending") };
    let approvals = Array.append(op.approvals, [caller]);
    let state : T.OpState = if (admin or approvals.size() >= threshold) { #approved(Time.now()) } else { #pending };
    let u = { op with approvals; state }; putOp(u);
    let cid = newCid();
    icrc3_add("guardian_op_approve", [("cid", #Nat(cid)), ("caller", pv(caller)), ("op", #Nat(id)), ("approvals", #Nat(approvals.size())), ("approved", #Text(debug_show(admin or approvals.size() >= threshold))), ("as_admin", #Text(debug_show(admin)))]);
    logText(cid, "info", "op " # Nat.toText(id) # " approved by " # Principal.toText(caller) # " (" # Nat.toText(approvals.size()) # "/" # Nat.toText(threshold) # ")");
    #Ok(u);
  };
  private func guardianAct(caller : Principal, id : Nat, ok : Bool) : { #Ok : T.Op; #Err : Text } {
    let op = switch (findOp(id)) { case (?o) { current(o) }; case null { return #Err("no op " # Nat.toText(id)) } };
    let pol = policyOf(op);
    if (not has(pol.guardians, caller)) { return #Err("only a guardian of this child can do that") };
    if (isExecuting(id)) { return #Err("op " # Nat.toText(id) # " is being executed") };
    switch (op.state) { case (#pending or #approved(_)) {}; case (s) { return #Err("op is " # debug_show(s)) } };
    if (ok) {
      if (has(op.oks, caller)) { return #Err("already ok'd") };
      let u = { op with oks = Array.append(op.oks, [caller]) }; putOp(u);
      let cid = newCid();
      icrc3_add("guardian_op_ok", [("cid", #Nat(cid)), ("caller", pv(caller)), ("op", #Nat(id)), ("oks", #Nat(u.oks.size()))]);
      #Ok(u);
    } else {
      if (has(op.vetoes, caller)) { return #Err("already vetoed") };
      let vetoes = Array.append(op.vetoes, [caller]);
      let blocked = pol.vetoes_to_block > 0 and vetoes.size() >= pol.vetoes_to_block;
      let u = { op with vetoes; state = if (blocked) { #vetoed } else { op.state } }; putOp(u);
      let cid = newCid();
      icrc3_add("guardian_op_veto", [("cid", #Nat(cid)), ("caller", pv(caller)), ("op", #Nat(id)), ("vetoes", #Nat(vetoes.size())), ("blocked", #Text(debug_show(blocked)))]);
      logText(cid, "info", "op " # Nat.toText(id) # " vetoed by " # Principal.toText(caller) # (if (blocked) { " and blocked" } else { "" }));
      #Ok(u);
    };
  };
  /// A guardian of the child gives the go-ahead.
  public shared ({ caller }) func ok_op(id : Nat) : async { #Ok : T.Op; #Err : Text } { guardianAct(caller, id, true) };
  /// A guardian of the child vetoes; enough vetoes block the op for good.
  public shared ({ caller }) func veto_op(id : Nat) : async { #Ok : T.Op; #Err : Text } { guardianAct(caller, id, false) };
  /// The stager or an approver withdraws an op that has not executed.
  public shared ({ caller }) func cancel_op(id : Nat) : async { #Ok : T.Op; #Err : Text } {
    let op = switch (findOp(id)) { case (?o) { current(o) }; case null { return #Err("no op " # Nat.toText(id)) } };
    if (caller != op.staged_by and not isApprover(caller)) { return #Err("only the stager or an approver can cancel") };
    if (isExecuting(id)) { return #Err("op " # Nat.toText(id) # " is being executed") };
    switch (op.state) { case (#pending or #approved(_)) {}; case (s) { return #Err("op is " # debug_show(s)) } };
    let u = { op with state = #cancelled }; putOp(u);
    icrc3_add("guardian_op_cancel", [("cid", #Nat(newCid())), ("caller", pv(caller)), ("op", #Nat(id))]);
    #Ok(u);
  };
  /// Why an approved op cannot execute yet, or null when it can.
  private func notReady(op : T.Op) : ?Text {
    let pol = policyOf(op);
    switch (op.state) {
      case (#approved(at)) {
        if (Time.now() < at + pol.window_ns) { return ?("the veto window is open until " # Int.toText(at + pol.window_ns)) };
        if (pol.vetoes_to_block > 0 and op.vetoes.size() >= pol.vetoes_to_block) { return ?"vetoed" };
        if (op.oks.size() < pol.oks_required) { return ?("needs " # Nat.toText(pol.oks_required) # " guardian go-aheads, has " # Nat.toText(op.oks.size())) };
        null;
      };
      case (s) { ?("op is " # debug_show(s) # ", not approved") };
    };
  };
  /// Run an approved op whose window has passed (anyone).
  public shared ({ caller }) func execute_op(id : Nat) : async { #Ok : T.Op; #Err : Text } {
    if (Principal.isAnonymous(caller)) { return #Err("log in first") };
    let op = switch (findOp(id)) { case (?o) { current(o) }; case null { return #Err("no op " # Nat.toText(id)) } };
    switch (notReady(op)) { case (?e) { return #Err(e) }; case null {} };
    if (isExecuting(id)) { return #Err("op " # Nat.toText(id) # " is already being executed") };
    executing := Array.append(executing, [id]);
    try { await* executeApproved(caller, id, op) } finally {
      executing := Array.filter<Nat>(executing, func(x) { x != id });
    };
  };
  private func executeApproved(caller : Principal, id : Nat, op : T.Op) : async* { #Ok : T.Op; #Err : Text } {
    let cid = newCid();
    // the fee first: it pays for the attempt, so a failed op keeps it (stage a new one)
    if (op.fee_e8s > 0 and op.fee_paid_e8s < op.fee_e8s) {
      let bal = switch (await* opBalance(id)) { case (#Ok(b)) { b }; case (#Err(e)) { return #Err(e) } };
      if (bal < op.fee_e8s + ICP_FEE) { return #Err("the op's fee is not paid: send " # Nat.toText(op.fee_e8s + ICP_FEE) # " e8s ICP to the guardian's subaccount " # hex(opSubaccount(id)) # " (it holds " # Nat.toText(bal) # ")") };
      let sweep = try { await icp_ledger().icrc1_transfer({ from_subaccount = ?opSubaccount(id); to = fee_destination; amount = op.fee_e8s; fee = ?ICP_FEE; memo = null; created_at_time = null }) } catch (e) { return #Err("fee transfer failed: " # Error.message(e)) };
      switch (sweep) { case (#Err(e)) { return #Err("fee transfer failed: " # debug_show(e)) }; case (#Ok(_)) {} };
      switch (findOp(id)) { case (?o) { putOp({ o with fee_paid_e8s = op.fee_e8s }) }; case null {} };
      icrc3_add("guardian_op_fee", [("cid", #Nat(cid)), ("op", #Nat(id)), ("payer", pv(op.payer)), ("amount_e8s", #Nat(op.fee_e8s)), ("to", pv(fee_destination.owner)), ("price_tier", #Text(SP.tierText(opTier(id))))]);
    };
    let r = await* perform(op, cid);
    // re-read: the op may have been cancelled or executed by a concurrent call across the awaits
    let latest = switch (findOp(id)) { case (?o) { o }; case null { op } };
    switch (latest.state) { case (#approved(_)) {}; case (s) { return #Err("op is now " # debug_show(s)) } };
    switch (r) {
      case (#Ok(())) {
        let u = { latest with state = #executed(Time.now()) }; putOp(u);
        icrc3_add("guardian_op_execute", [("cid", #Nat(cid)), ("caller", pv(caller)), ("op", #Nat(id)), ("canister", pv(op.child)), ("what", #Text(opKindText(op.kind)))]);
        logText(cid, "info", "op " # Nat.toText(id) # " executed by " # Principal.toText(caller));
        #Ok(u);
      };
      case (#Err(e)) {
        let u = { latest with state = #failed(e) }; putOp(u);
        icrc3_add("guardian_op_fail", [("cid", #Nat(cid)), ("caller", pv(caller)), ("op", #Nat(id)), ("canister", pv(op.child)), ("error", #Text(e))]);
        logText(cid, "error", "op " # Nat.toText(id) # " failed: " # e);
        #Err(e);
      };
    };
  };
  private func perform(op : T.Op, cid : Nat) : async* { #Ok; #Err : Text } {
    switch (op.kind) {
      case (#set_controllers(ps)) {
        let c = switch (findChild(op.child)) { case (?c) { c }; case null { return #Err("not a registered child any more") } };
        try {
          await ic.update_settings({ canister_id = op.child; settings = { controllers = ?ps; compute_allocation = null; memory_allocation = null; freezing_threshold = null }; sender_canister_version = null });
        } catch (e) { return #Err("update_settings failed: " # Error.message(e)) };
        if (not has(ps, self())) {
          dropChild(op.child);
          icrc3_add("guardian_release", [("cid", #Nat(cid)), ("op", #Nat(op.id)), ("canister", pv(op.child)), ("kind", #Text(kindText(c.kind))), ("controllers", plist(ps))]);
          logText(cid, "info", "released " # Principal.toText(op.child) # " to " # debug_show(ps));
        } else {
          ignore await* refreshChildStatus(c);
        };
        #Ok;
      };
      case (#install(i)) {
        let c = switch (findChild(op.child)) { case (?c) { c }; case null { return #Err("not a registered child any more") } };
        await* upgradeChild(c, i.hash, i.arg, "op " # Nat.toText(op.id), cid);
      };
      case (#set_policy(p)) {
        let c = switch (findChild(op.child)) { case (?c) { c }; case null { return #Err("not a registered child any more") } };
        putChild({ c with policy = p });
        icrc3_add("guardian_policy_set", [("cid", #Nat(cid)), ("op", #Nat(op.id)), ("canister", pv(op.child)), ("guardians", plist(p.guardians)), ("vetoes_to_block", #Nat(p.vetoes_to_block)), ("oks_required", #Nat(p.oks_required)), ("window_ns", #Nat(p.window_ns)), ("auto_upgrade", #Text(debug_show(p.auto_upgrade)))]);
        #Ok;
      };
      case (#set_config(u)) { applyConfig<system>(u, cid, op.id); #Ok };
      case (#set_approvers(a)) {
        approvers := a.approvers; threshold := a.threshold;
        icrc3_add("guardian_approvers_set", [("cid", #Nat(cid)), ("op", #Nat(op.id)), ("approvers", plist(a.approvers)), ("threshold", #Nat(a.threshold))]);
        #Ok;
      };
    };
  };
  private func applyConfig<system>(u : T.ConfigUpdate, cid : Nat, opId : Nat) {
    let note = func(key : Text, old : Text, new_ : Text) { icrc3_add("guardian_config_update", [("cid", #Nat(cid)), ("op", #Nat(opId)), ("key", #Text(key)), ("old_value", #Text(old)), ("value", #Text(new_))]) };
    switch (u.op_fee_e8s) { case (?v) { note("op_fee_e8s", Nat.toText(op_fee_e8s), Nat.toText(v)); op_fee_e8s := v }; case null {} };
    switch (u.premium_op_fee_e8s) { case (?v) { note("premium_op_fee_e8s", Nat.toText(premium_op_fee_e8s), Nat.toText(v)); premium_op_fee_e8s := v }; case null {} };
    switch (u.fee_destination) { case (?v) { note("fee_destination", Principal.toText(fee_destination.owner), Principal.toText(v.owner)); fee_destination := v }; case null {} };
    switch (u.op_ttl_ns) { case (?v) { if (v >= 86_400_000_000_000) { note("op_ttl_ns", Nat.toText(op_ttl_ns), Nat.toText(v)); op_ttl_ns := v } }; case null {} };
    switch (u.self_window_ns) { case (?v) { if (v <= MAX_WINDOW_NS) { note("self_window_ns", Nat.toText(self_window_ns), Nat.toText(v)); self_window_ns := v } }; case null {} };
    switch (u.status_interval_s) { case (?v) { if (v >= 600) { note("status_interval_s", Nat.toText(status_interval_s), Nat.toText(v)); status_interval_s := v; restartStatusTimer<system>() } }; case null {} };
    switch (u.low_cycles_threshold) { case (?v) { note("low_cycles_threshold", Nat.toText(low_cycles_threshold), Nat.toText(v)); low_cycles_threshold := v }; case null {} };
    switch (u.cycle_reserve) { case (?v) { note("cycle_reserve", Nat.toText(cycle_reserve), Nat.toText(v)); cycle_reserve := v }; case null {} };
    switch (u.paused) { case (?v) { note("paused", debug_show(paused), debug_show(v)); paused := v }; case null {} };
    switch (u.approve_function_id) { case (?v) { note("approve_function_id", debug_show(approve_function_id), debug_show(v)); approve_function_id := v }; case null {} };
  };

  // ---- upgrades along the blessed path ----
  private func defaultArg(k : T.Kind) : Blob {
    switch (k) {
      case (#ledger) { let a : ?{ #Upgrade : ?{} } = ?(#Upgrade(null)); to_candid(a) }; // opt LedgerArg = Upgrade(null): no changes
      case (#index) { let a : ?{ #Upgrade : {} } = ?(#Upgrade({})); to_candid(a) }; // opt IndexArg = Upgrade(record {}): no changes
      case (#archive) { let a : ?{} = null; to_candid(a) };
    };
  };
  private func fetchWasm(hash : Blob) : async* { #Ok : Blob; #Err : Text } {
    let r = try { await sns_wasm().get_wasm({ hash = hash }) } catch (e) { return #Err("SNS wasm canister: " # Error.message(e)) };
    switch (r.wasm) {
      case (?w) { if (sha256(w.wasm) != hash) { return #Err("the SNS wasm canister returned bytes whose hash is " # hex(sha256(w.wasm)) # ", not " # hex(hash)) }; #Ok(w.wasm) };
      case null { #Err("the SNS wasm canister has no wasm with hash " # hex(hash)) };
    };
  };
  /// Upgrade a child to `hash`, which must be the next blessed hash after its current one.
  private func upgradeChild(c0 : T.Child, hash : Blob, arg : ?Blob, by : Text, cid : Nat) : async* { #Ok; #Err : Text } {
    let c = await* refreshChildStatus(c0);
    let currentHash = switch (c.status) { case (?s) { switch (s.error) { case (?e) { return #Err("could not read the canister's status: " # e) }; case null { s.module_hash } } }; case null { null } };
    let cur = switch (currentHash) { case (?h) { h }; case null { return #Err("the canister has no code installed") } };
    // the same code with an explicit argument is a reconfiguration (e.g. pointing a ledger at its
    // index through ICRC-106); otherwise the hash must be the next blessed one
    let reconfigure = cur == hash and arg != null;
    if (cur == hash and not reconfigure) { return #Err("already on " # hex(hash) # "; give an upgrade argument to reconfigure") };
    if (not reconfigure) {
      switch (nextBlessed(c.kind, cur)) {
        case (?n) { if (n != hash) { return #Err("the next blessed " # kindText(c.kind) # " after " # hex(cur) # " is " # hex(n) # ", not " # hex(hash) # "; upgrades go one step at a time") } };
        case null { return #Err("the canister's current code (" # hex(cur) # ") is not on the blessed list, or is already its last version") };
      };
    };
    let wasm = switch (await* fetchWasm(hash)) { case (#Ok(w)) { w }; case (#Err(e)) { return #Err(e) } };
    let argBytes = switch (arg) { case (?a) { a }; case null { defaultArg(c.kind) } };
    try {
      await ic.install_code({ mode = #upgrade(null); canister_id = c.canister_id; wasm_module = wasm; arg = argBytes; sender_canister_version = null });
    } catch (e) {
      let msg = "install_code failed: " # Error.message(e);
      putChild({ c with last_upgrade_error = ?msg });
      return #Err(msg);
    };
    let after = await* refreshChildStatus(c);
    putChild({ after with last_upgrade = ?{ at = Time.now(); from = ?cur; to = hash; by }; last_upgrade_error = null });
    icrc3_add("guardian_upgrade", [("cid", #Nat(cid)), ("canister", pv(c.canister_id)), ("kind", #Text(kindText(c.kind))), ("from", #Blob(cur)), ("to", #Blob(hash)), ("by", #Text(by)), ("reconfigure", #Text(debug_show(reconfigure)))]);
    logText(cid, "info", "upgraded " # kindText(c.kind) # " " # Principal.toText(c.canister_id) # " " # hex(cur) # " -> " # hex(hash) # " (" # by # ")");
    #Ok;
  };
  /// Children that have a next blessed version, from the last status reading.
  public query func list_upgradable() : async [T.Upgradable] {
    let out = Buffer.Buffer<T.Upgradable>(8);
    for (c in children.vals()) {
      switch (c.status) {
        case (?s) { switch (s.module_hash) { case (?h) { switch (nextBlessed(c.kind, h)) { case (?n) { out.add({ canister_id = c.canister_id; kind = c.kind; title = c.title; current = ?h; next = n; auto_upgrade = c.policy.auto_upgrade }) }; case null {} } }; case null {} } };
        case null {};
      };
    };
    Buffer.toArray(out);
  };
  /// One step along the blessed path for every child with auto-upgrade: ledgers, then indexes, then archives.
  private func autoUpgradeImpl() : async* Nat {
    if (upgrade_running or paused) { return 0 };
    upgrade_running := true;
    var n = 0;
    try {
      await* ensureBlessed();
      for (kind in [#ledger, #index, #archive].vals()) {
        for (c0 in Array.filter<T.Child>(children, func(c) { c.kind == kind and c.policy.auto_upgrade }).vals()) {
          let c = await* refreshChildStatus(c0);
          let cur = switch (c.status) { case (?s) { if (s.error != null) { null } else { s.module_hash } }; case null { null } };
          switch (cur) {
            case (?h) {
              switch (nextBlessed(kind, h)) {
                case (?next) {
                  switch (await* upgradeChild(c, next, null, "auto", newCid())) { case (#Ok) { n += 1 }; case (#Err(e)) { putChild({ c with last_upgrade_error = ?e }) } };
                };
                case null {};
              };
            };
            case null {};
          };
        };
      };
    } catch (e) { logText(newCid(), "error", "auto-upgrade run: " # Error.message(e)) };
    upgrade_running := false;
    n;
  };

  // ---- status timer: cycles of every child, archive discovery ----
  private func statusRunImpl() : async* Nat {
    if (status_running) { return 0 };
    status_running := true;
    status_last_run := Time.now();
    var n = 0;
    try {
      for (c in children.vals()) { ignore await* refreshChildStatus(c); n += 1 };
      // archives a ledger spawned since: registered under the ledger's policy when the guardian controls them and their code is blessed
      for (l in Array.filter<T.Child>(children, func(c) { c.kind == #ledger }).vals()) {
        let ledger : T.LedgerActor = actor (Principal.toText(l.canister_id));
        let archives = try { await ledger.archives() } catch (_) { [] };
        for (a in archives.vals()) {
          if (findChild(a.canister_id) == null) {
            switch (await* readStatus(a.canister_id)) {
              case (#Ok(st)) {
                switch (st.module_hash) {
                  case (?h) {
                    if (isBlessed(#archive, h)) {
                      let child : T.Child = { canister_id = a.canister_id; kind = #archive; suite = ?l.canister_id; title = l.title # " archive"; policy = l.policy; registered_at = Time.now(); registered_by = self(); status = ?st; last_upgrade = null; last_upgrade_error = null };
                      putChild(child);
                      let cid = newCid();
                      icrc3_add("guardian_register", [("cid", #Nat(cid)), ("caller", pv(self())), ("canister", pv(a.canister_id)), ("kind", #Text("archive")), ("title", #Text(child.title)), ("guardians", plist(l.policy.guardians)), ("auto_upgrade", #Text(debug_show(l.policy.auto_upgrade)))]);
                      logText(cid, "info", "discovered archive " # Principal.toText(a.canister_id) # " of " # l.title);
                    };
                  };
                  case null {};
                };
              };
              case (#Err(_)) {}; // not ours to control
            };
          };
        };
      };
    } catch (e) { logText(newCid(), "error", "status run: " # Error.message(e)) };
    status_running := false;
    n;
  };
  /// Re-read one child's status now (anyone, at most once a minute across all callers).
  public shared ({ caller }) func refresh_status(canister_id : Principal) : async { #Ok : T.Child; #Err : Text } {
    if (not isAdmin(caller) and Time.now() - status_last_forced < STATUS_MIN_GAP_NS) { return #Err("refreshed recently; try again in a minute") };
    status_last_forced := Time.now();
    switch (findChild(canister_id)) { case (?c) { #Ok(await* refreshChildStatus(c)) }; case null { #Err("not a registered child") } };
  };

  // ---- timers ----
  transient var status_timer : ?Timer.TimerId = null;
  private func status_job() : async () { ignore await* statusRunImpl() };
  private func upgrade_job() : async () { ignore await* autoUpgradeImpl() };
  private func restartStatusTimer<system>() {
    switch (status_timer) { case (?t) { Timer.cancelTimer(t) }; case null {} };
    status_timer := ?Timer.recurringTimer<system>(#seconds status_interval_s, status_job);
  };
  private func ensureTimers<system>() {
    if (timers_started) { return };
    timers_started := true;
    Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job);
    restartStatusTimer<system>();
    ignore Timer.recurringTimer<system>(#seconds 86_400, upgrade_job);
    ignore Timer.setTimer<system>(#seconds 2, func() : async () { ignore await* refreshBlessedImpl() });
  };

  // ---- queries ----
  public query func get_config() : async T.Config {
    {
      name; approvers; threshold; admins; approve_function_id; op_fee_e8s; premium_op_fee_e8s; fee_destination; sneed_premium = sneed_premium_id; icp_ledger = icp_ledger_id; sns_wasm = sns_wasm_id;
      op_ttl_ns; self_window_ns; status_interval_s; low_cycles_threshold; cycle_reserve; paused; children = children.size(); ops = ops.size();
      blessed = { ledger = blessed_ledger; index = blessed_index; archive = blessed_archive }; blessed_at; blessed_error; status_last_run; own_cycles = Cycles.balance();
    };
  };
  public query func get_child(canister_id : Principal) : async ?T.Child { findChild(canister_id) };
  public query func list_children() : async [T.Child] { children };
  /// Children of one ledger: the ledger, its index, its archives.
  public query func get_suite(ledger : Principal) : async [T.Child] { Array.filter<T.Child>(children, func(c) { c.canister_id == ledger or c.suite == ?ledger }) };
  public query func get_op(id : Nat) : async ?T.Op { switch (findOp(id)) { case (?o) { ?(if (Time.now() > o.staged_at + op_ttl_ns and (o.state == #pending or (switch (o.state) { case (#approved(_)) { true }; case _ { false } }))) { { o with state = #expired } } else { o }) }; case null { null } } };
  /// Ops, newest first; `open` keeps only pending and approved ones. At most 100 (`limit` 0 = 50),
  /// and fewer when install arguments pass about 1.5 MB; list_op_summaries pages without the bytes.
  public query func list_ops(open : Bool, limit : Nat) : async [T.Op] {
    pickOps(func(o) { not open or openKeep(o) }, null, pageLimit(limit), true).0;
  };
  /// The newest ops on one canister (at most 100, fewer past about 1.5 MB of install arguments);
  /// list_op_summaries with `child` pages through all of them.
  public query func list_ops_for(canister_id : Principal) : async [T.Op] {
    pickOps(func(o) { o.child == canister_id }, null, MAX_PAGE, true).0;
  };
  /// A page of ops, newest first, without install argument bytes (size and SHA-256 instead; the
  /// bytes come with get_op). Pass `next` back as `before` until it is null.
  public query func list_op_summaries(a : T.OpPageArgs) : async T.OpPage {
    let (picked, next) = pickOps(func(o) { (not a.open or openKeep(o)) and (switch (a.child) { case (?c) { o.child == c }; case null { true } }) }, a.before, pageLimit(a.limit), false);
    { items = Array.map<T.Op, T.OpSummary>(picked, summaryOf); next };
  };
  /// The anti-spam limits on staging ops.
  public query func get_op_limits() : async T.OpLimits { { max_open_ops_per_caller; max_install_arg_bytes = MAX_INSTALL_ARG; max_page = MAX_PAGE } };
  /// The per-caller rate limits (calls at once, refilled per minute; capacity 0 = no limit).
  public query func get_rate_limits() : async [(Text, RateLimit.Rule)] { RateRules.all(rate_rules, RATE_DEFAULTS) };
  /// Every child's cycles from the last reading, with the ones under the threshold flagged; the guardian's own balance comes first.
  public query func get_cycles_report(threshold_cycles : ?Nat) : async [T.CyclesRow] {
    let th = switch (threshold_cycles) { case (?t) { t }; case null { low_cycles_threshold } };
    let out = Buffer.Buffer<T.CyclesRow>(children.size() + 1);
    out.add({ canister_id = self(); title = name # " (the guardian itself)"; kind = #ledger; cycles = Cycles.balance(); at = Time.now(); low = Cycles.balance() < th; error = null });
    for (c in children.vals()) {
      switch (c.status) {
        case (?s) { out.add({ canister_id = c.canister_id; title = c.title; kind = c.kind; cycles = s.cycles; at = s.at; low = s.cycles < th; error = s.error }) };
        case null { out.add({ canister_id = c.canister_id; title = c.title; kind = c.kind; cycles = 0; at = 0; low = true; error = ?"never read" }) };
      };
    };
    Buffer.toArray(out);
  };
  public query func get_text_log(limit : Nat) : async [Text] { let n = text_log.size(); if (limit == 0 or limit >= n) { text_log } else { Array.subArray(text_log, n - limit, limit) } };
  public query func is_approver(p : Principal) : async Bool { isApprover(p) };

  // ---- controllers only (nobody once blackholed): mocks for tests, timers now ----
  public shared ({ caller }) func admin_set_canisters(u : { icp_ledger : ?Principal; sns_wasm : ?Principal; sneed_premium : ??Principal }) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admins only") };
    switch (u.icp_ledger) { case (?p) { icp_ledger_id := p }; case null {} };
    switch (u.sns_wasm) { case (?p) { sns_wasm_id := p }; case null {} };
    switch (u.sneed_premium) { case (?p) { sneed_premium_id := p; premium_cache := PremiumClient.emptyCache() }; case null {} };
    #Ok;
  };
  /// Admins may add admins while the deployment is being tried out, and remove themselves or each
  /// other as it matures; once the list is empty (and there are no controllers) it stays empty.
  public shared ({ caller }) func admin_add_admin(p : Principal) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admins only") };
    if (Principal.isAnonymous(p)) { return #Err("not the anonymous principal") };
    if (not has(admins, p)) { admins := Array.append(admins, [p]); icrc3_add("guardian_config_update", [("cid", #Nat(newCid())), ("caller", pv(caller)), ("key", #Text("admin_added")), ("old_value", #Text("")), ("value", #Text(Principal.toText(p)))]) };
    #Ok;
  };
  public shared ({ caller }) func admin_remove_admin(p : Principal) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admins only") };
    if (has(admins, p)) { admins := Array.filter<Principal>(admins, func(a) { a != p }); icrc3_add("guardian_config_update", [("cid", #Nat(newCid())), ("caller", pv(caller)), ("key", #Text("admin_removed")), ("old_value", #Text(Principal.toText(p))), ("value", #Text(""))]) };
    #Ok;
  };
  public query func get_admins() : async [Principal] { admins };
  /// How many open ops one principal may have staged at once (admins: no limit). At least 1.
  public shared ({ caller }) func admin_set_max_open_ops(n : Nat) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admins only") };
    if (n == 0 or n > 10_000) { return #Err("between 1 and 10000") };
    let old = max_open_ops_per_caller;
    max_open_ops_per_caller := n;
    icrc3_add("guardian_config_update", [("cid", #Nat(newCid())), ("caller", pv(caller)), ("key", #Text("max_open_ops_per_caller")), ("old_value", #Nat(old)), ("value", #Nat(n))]);
    #Ok;
  };
  /// Set a per-caller rate limit (null: back to the default). Actions: see get_rate_limits.
  public shared ({ caller }) func admin_set_rate_limit(action : Text, rule : ?RateLimit.Rule) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admins only") };
    switch (RateRules.set(rate_rules, RATE_DEFAULTS, action, rule)) {
      case (#err(e)) { #Err(e) };
      case (#ok(r)) {
        rate_rules := r;
        let v : T3.Value = switch (rule) { case (?x) { #Map([("capacity", #Nat(x.capacity)), ("per_minute", #Nat(x.per_minute))]) }; case null { #Text("default") } };
        icrc3_add("guardian_config_update", [("cid", #Nat(newCid())), ("caller", pv(caller)), ("key", #Text("rate_limit")), ("action", #Text(action)), ("value", v)]);
        #Ok;
      };
    };
  };

  // ---- special prices (spec/special_prices.md) ----
  /// The op fee's special prices `p` gets: the admin price when it is an admin and a person, its
  /// partner entry when it has not expired.
  private func specialFor(p : Principal) : { admin : ?Nat; partner : ?Nat } {
    {
      admin = if (SP.isPerson(p) and isAdmin(p)) { admin_prices.op_fee_e8s } else { null };
      partner = switch (SP.activePartner(partner_prices, p, Time.now())) { case (?e) { e.prices.op_fee_e8s }; case null { null } };
    };
  };
  private func opTier(id : Nat) : T.Tier { switch (Map.get(op_price_tiers, nhash, id)) { case (?t) { t }; case null { #regular } } };
  /// Who may set special prices: whoever can change the op fee on its own. An admin can (its
  /// approval of a #set_config op counts as the whole threshold), and so can an approver when it
  /// alone is the threshold (a single DAO). With several approvers only admins can, since special
  /// prices are not an op kind (adding one would change stage_op's and get_op's Candid).
  private func canSetPrices(p : Principal) : Bool { isAdmin(p) or (isApprover(p) and threshold <= 1) };
  private func pricesFields(x : T.Prices) : [(Text, ?Nat)] { [("op_fee_e8s", x.op_fee_e8s)] };
  private func priceNote(caller : Principal, key : Text, extra : [(Text, T3.Value)], old : T3.Value, new_ : T3.Value) {
    icrc3_add("guardian_config_update", Array.append<(Text, T3.Value)>([("cid", #Nat(newCid())), ("caller", pv(caller)), ("key", #Text(key))], Array.append<(Text, T3.Value)>(extra, [("old_value", old), ("value", new_)])));
  };
  private func partnerV(e : ?SP.Partner<T.Prices>) : T3.Value {
    switch (e) { case (?x) { SP.partnerValue(x.label_, pricesFields(x.prices), x.expires_at) }; case null { #Text("none") } };
  };
  /// The admin price of the op fee (admins, or the approver when it alone is the threshold).
  public shared ({ caller }) func set_admin_prices(p : T.Prices) : async { #ok; #err : Text } {
    if (not canSetPrices(caller)) { return #err("admins only (or the approver, when it alone is the threshold)") };
    let old = admin_prices;
    admin_prices := p;
    priceNote(caller, "admin_prices", [], SP.overridesValue(pricesFields(old)), SP.overridesValue(pricesFields(p)));
    #ok;
  };
  /// Add or replace a partner's op fee. The label is public; `expires_at` (ns) is optional.
  public shared ({ caller }) func set_partner_prices(partner : Principal, e : SP.Partner<T.Prices>) : async { #ok; #err : Text } {
    if (not canSetPrices(caller)) { return #err("admins only (or the approver, when it alone is the threshold)") };
    switch (SP.validatePartner(partner_prices, partner, e, Time.now())) { case (?why) { return #err(why) }; case null {} };
    let old = Map.get(partner_prices, phash, partner);
    Map.set(partner_prices, phash, partner, e);
    priceNote(caller, "partner_prices", [("partner", pv(partner))], partnerV(old), partnerV(?e));
    #ok;
  };
  /// Remove a partner's prices.
  public shared ({ caller }) func remove_partner_prices(partner : Principal) : async { #ok; #err : Text } {
    if (not canSetPrices(caller)) { return #err("admins only (or the approver, when it alone is the threshold)") };
    switch (Map.remove(partner_prices, phash, partner)) {
      case (?old) { priceNote(caller, "partner_prices", [("partner", pv(partner))], partnerV(?old), #Text("removed")); #ok };
      case null { #err("no partner prices for that principal") };
    };
  };
  /// The admin price and every partner entry (expired ones too, with their expiry). Public.
  public query func get_special_prices() : async { admin_prices : T.Prices; partners : [SP.PartnerListing<T.Prices>] } {
    { admin_prices; partners = SP.listing(partner_prices) };
  };
  /// The special prices that apply to `p` when it stages and pays an op itself.
  public query func get_special_prices_for(p : Principal) : async { admin_prices : ?T.Prices; partner : ?SP.Partner<T.Prices> } {
    { admin_prices = if (SP.isPerson(p) and isAdmin(p)) { ?admin_prices } else { null }; partner = SP.activePartner(partner_prices, p, Time.now()) };
  };
  /// Which price an op's fee was set at; null for ops staged before special prices.
  public query func get_op_price_tier(id : Nat) : async ?T.Tier { Map.get(op_price_tiers, nhash, id) };
  /// Admins record the generic function's id during the trial period (afterwards: a #set_config op).
  public shared ({ caller }) func admin_set_approve_function_id(id : ?Nat64) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admins only") };
    icrc3_add("guardian_config_update", [("cid", #Nat(newCid())), ("caller", pv(caller)), ("key", #Text("approve_function_id")), ("old_value", #Text(debug_show(approve_function_id))), ("value", #Text(debug_show(id)))]);
    approve_function_id := id;
    #Ok;
  };
  public shared ({ caller }) func admin_run_status() : async { #Ok : Nat; #Err : Text } { if (not isAdmin(caller)) { return #Err("admins only") }; #Ok(await* statusRunImpl()) };
  public shared ({ caller }) func admin_run_auto_upgrade() : async { #Ok : Nat; #Err : Text } { if (not isAdmin(caller)) { return #Err("admins only") }; #Ok(await* autoUpgradeImpl()) };

  // ---- ICRC-3 endpoints ----
  public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult { Icrc3Log.getBlocks(icrc3, args) };
  public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult { Icrc3Log.getArchives(icrc3, args) };
  public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate { Icrc3Log.tipCertificate(icrc3) };
  public query func icrc3_supported_block_types() : async [T3.BlockType] { Icrc3Log.supportedBlockTypes(icrc3_catalogue) };
  public query func icrc10_supported_standards() : async [T3.SupportedStandard] { Icrc3Log.supportedStandards() };
  public query func icrc3_log_status() : async T3.LogStatus { Icrc3Log.status(icrc3, icrc3_rt) };

  system func postupgrade() { ensureTimers<system>() };
  ensureTimers<system>();
  ignore installer;

  // Limits of the ingress guard below
  transient let MAX_TITLE = 64;
  transient let MAX_MEMO = 500;
  transient let MAX_STAGE_ARG = 262_144 + 8_192; // MAX_INSTALL_ARG plus the rest of the call

  // Ingress guard (src/IngressGuard.mo): queries are never accepted as update calls, which
  // would go through consensus at our cost, and arguments are capped in size.
  system func inspect({ caller : Principal; arg : Blob; msg : {
    #admin_add_admin : Any;
    #admin_remove_admin : Any;
    #admin_run_auto_upgrade : Any;
    #admin_run_status : Any;
    #admin_set_approve_function_id : Any;
    #admin_set_canisters : Any;
    #admin_set_max_open_ops : Any;
    #admin_set_rate_limit : Any;
    #approve_op : Any;
    #cancel_op : Any;
    #execute_op : Any;
    #get_admins : Any;
    #get_child : Any;
    #get_config : Any;
    #get_cycles_report : Any;
    #get_op : Any;
    #get_op_limits : Any;
    #get_op_payment : Any;
    #get_op_price_tier : Any;
    #get_special_prices : Any;
    #get_rate_limits : Any;
    #get_special_prices_for : Any;
    #get_suite : Any;
    #get_text_log : Any;
    #icrc10_supported_standards : Any;
    #icrc3_get_archives : Any;
    #icrc3_get_blocks : Any;
    #icrc3_get_tip_certificate : Any;
    #icrc3_log_status : Any;
    #icrc3_supported_block_types : Any;
    #is_approver : Any;
    #list_children : Any;
    #list_op_summaries : Any;
    #list_ops : Any;
    #list_ops_for : Any;
    #list_upgradable : Any;
    #ok_op : Any;
    #refresh_blessed : Any;
    #refresh_status : Any;
    #refund_op : Any;
    #remove_partner_prices : Any;
    #set_admin_prices : Any;
    #set_partner_prices : () -> (Principal, SP.Partner<T.Prices>);
    #register : () -> (Principal, T.Kind, T.Policy, ?Principal, Text);
    #stage_op : () -> (Principal, T.OpKind, Text, ?Principal);
    #validate_approve_op : Any;
    #veto_op : Any;
  } }) : Bool {
    switch (msg) {
      case (
        #get_admins _
        or #get_child _
        or #get_config _
        or #get_cycles_report _
        or #get_op _
        or #get_op_limits _
        or #get_op_price_tier _
        or #get_rate_limits _
        or #get_special_prices _
        or #get_special_prices_for _
        or #get_suite _
        or #get_text_log _
        or #icrc10_supported_standards _
        or #icrc3_get_archives _
        or #icrc3_get_blocks _
        or #icrc3_get_tip_certificate _
        or #icrc3_log_status _
        or #icrc3_supported_block_types _
        or #is_approver _
        or #list_children _
        or #list_op_summaries _
        or #list_ops _
        or #list_ops_for _
        or #list_upgradable _
      ) false;
      // the limits of register and stage_op; an install may carry an upgrade argument
      // rate limits peek here (admins are not limited); the methods take the token
      case (#register f) arg.size() <= IngressGuard.textArg(MAX_TITLE) and IngressGuard.text(f().4, MAX_TITLE) and rateAllows(caller, "register");
      case (#stage_op f) arg.size() <= MAX_STAGE_ARG and IngressGuard.text(f().2, MAX_MEMO) and rateAllows(caller, "stage_op");
      case (#refund_op _) arg.size() <= IngressGuard.SMALL_ARG and rateAllows(caller, "refund_op");
      case (#set_partner_prices f) arg.size() <= IngressGuard.SMALL_ARG and IngressGuard.text(f().1.label_, SP.MAX_LABEL_CHARS);
      case _ arg.size() <= IngressGuard.SMALL_ARG;
    };
  };

};
