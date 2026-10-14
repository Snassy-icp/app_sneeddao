/// sneed_guardian: a custody canister that is the controller of ledger-suite
/// canisters (ledger, index, archives) on behalf of one or more DAOs.
///
/// Deployed three ways from this one codebase (spec/custody.md): under SNS
/// root control as `sneed_guardian`, blackholed with Sneed governance as the
/// only approver as `sneed_hole`, and blackholed with several DAOs' governance
/// canisters as `sneed_accord`. Nothing here depends on having a controller:
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

import T "Types";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";

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
  stable var sneed_premium_id : ?Principal = init.sneed_premium;
  stable var premium_cache = PremiumClient.emptyCache();
  stable var icp_ledger_id : Principal = switch (init.icp_ledger) { case (?p) { p }; case null { Principal.fromText(ICP_LEDGER_ID) } };
  stable var sns_wasm_id : Principal = switch (init.sns_wasm) { case (?p) { p }; case null { Principal.fromText(SNS_WASM_ID) } };
  stable var fee_destination : T.Account = switch (init.fee_destination) { case (?a) { a }; case null { { owner = Principal.fromText(RLL_ID); subaccount = null } } };
  stable var op_fee_e8s : Nat = 100_000_000; // 1 ICP
  stable var premium_op_fee_e8s : Nat = 50_000_000;
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
    block_types = ["guardian_register", "guardian_release", "guardian_op_stage", "guardian_op_approve", "guardian_op_ok", "guardian_op_veto", "guardian_op_execute", "guardian_op_fail", "guardian_op_cancel", "guardian_upgrade", "guardian_config_update", "guardian_approvers_set", "guardian_policy_set"];
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
  /// Propose a change (anyone). The op fee, if any, is pulled from the caller on the ICP ledger
  /// (ICRC-2) and forwarded to the fee destination before the op is recorded.
  public shared ({ caller }) func stage_op(child : Principal, kind : T.OpKind, memo : Text) : async { #Ok : T.Op; #Err : Text } {
    if (paused) { return #Err("the guardian is paused") };
    if (Principal.isAnonymous(caller)) { return #Err("log in first") };
    if (memo.size() > 500) { return #Err("memo: at most 500 characters") };
    if (kind == #set_config({ op_fee_e8s = null; premium_op_fee_e8s = null; fee_destination = null; op_ttl_ns = null; self_window_ns = null; status_interval_s = null; low_cycles_threshold = null; cycle_reserve = null; paused = null })) { return #Err("an empty configuration change") };
    switch (kind) { case (#install(_)) { await* ensureBlessed() }; case _ {} };
    switch (validateOp(child, kind)) { case (?e) { return #Err(e) }; case null {} };
    let fee = if (child == self()) { 0 } else if (await* isPremium(caller)) { premium_op_fee_e8s } else { op_fee_e8s };
    if (fee > 0) {
      let r = try {
        await icp_ledger().icrc2_transfer_from({ spender_subaccount = null; from = { owner = caller; subaccount = null }; to = fee_destination; amount = fee; fee = ?ICP_FEE; memo = null; created_at_time = null });
      } catch (e) { return #Err("fee payment failed: " # Error.message(e)) };
      switch (r) {
        case (#Err(#InsufficientAllowance(a))) { return #Err("approve the guardian for " # Nat.toText(fee + ICP_FEE) # " e8s on the ICP ledger first (allowance is " # Nat.toText(a.allowance) # ")") };
        case (#Err(#InsufficientFunds(b))) { return #Err("not enough ICP: balance " # Nat.toText(b.balance) # " e8s, need " # Nat.toText(fee + ICP_FEE)) };
        case (#Err(e)) { return #Err("fee payment failed: " # debug_show(e)) };
        case (#Ok(_)) {};
      };
    };
    let op : T.Op = { id = next_op_id; child; kind; staged_by = caller; staged_at = Time.now(); memo; fee_paid_e8s = fee; approvals = []; oks = []; vetoes = []; state = #pending };
    next_op_id += 1;
    ops := Array.append(ops, [op]);
    let cid = newCid();
    icrc3_add("guardian_op_stage", [("cid", #Nat(cid)), ("caller", pv(caller)), ("op", #Nat(op.id)), ("canister", pv(child)), ("what", #Text(opKindText(kind))), ("fee_e8s", #Nat(fee)), ("memo", #Text(memo))]);
    logText(cid, "info", "op " # Nat.toText(op.id) # " staged by " # Principal.toText(caller) # ": " # opKindText(kind) # " on " # Principal.toText(child));
    #Ok(op);
  };
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
    # "State: " # debug_show(op.state) # "; approvals " # Nat.toText(op.approvals.size()) # ", oks " # Nat.toText(op.oks.size()) # ", vetoes " # Nat.toText(op.vetoes.size()) # ".";
  };
  /// The proposal text for an `approve_op` generic function (its validator).
  public query func validate_approve_op(id : Nat) : async { #Ok : Text; #Err : Text } {
    switch (findOp(id)) {
      case null { #Err("no op " # Nat.toText(id)) };
      case (?op) { switch (op.state) { case (#pending) { #Ok(describeOp(op)) }; case (s) { #Err("op " # Nat.toText(id) # " is " # debug_show(s) # ", not pending") } } };
    };
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
    let cid = newCid();
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
    if (cur == hash) { return #Err("already on " # hex(hash)) };
    switch (nextBlessed(c.kind, cur)) {
      case (?n) { if (n != hash) { return #Err("the next blessed " # kindText(c.kind) # " after " # hex(cur) # " is " # hex(n) # ", not " # hex(hash) # "; upgrades go one step at a time") } };
      case null { return #Err("the canister's current code (" # hex(cur) # ") is not on the blessed list, or is already its last version") };
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
    icrc3_add("guardian_upgrade", [("cid", #Nat(cid)), ("canister", pv(c.canister_id)), ("kind", #Text(kindText(c.kind))), ("from", #Blob(cur)), ("to", #Blob(hash)), ("by", #Text(by))]);
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
      name; approvers; threshold; admins; op_fee_e8s; premium_op_fee_e8s; fee_destination; sneed_premium = sneed_premium_id; icp_ledger = icp_ledger_id; sns_wasm = sns_wasm_id;
      op_ttl_ns; self_window_ns; status_interval_s; low_cycles_threshold; cycle_reserve; paused; children = children.size(); ops = ops.size();
      blessed = { ledger = blessed_ledger; index = blessed_index; archive = blessed_archive }; blessed_at; blessed_error; status_last_run; own_cycles = Cycles.balance();
    };
  };
  public query func get_child(canister_id : Principal) : async ?T.Child { findChild(canister_id) };
  public query func list_children() : async [T.Child] { children };
  /// Children of one ledger: the ledger, its index, its archives.
  public query func get_suite(ledger : Principal) : async [T.Child] { Array.filter<T.Child>(children, func(c) { c.canister_id == ledger or c.suite == ?ledger }) };
  public query func get_op(id : Nat) : async ?T.Op { switch (findOp(id)) { case (?o) { ?(if (Time.now() > o.staged_at + op_ttl_ns and (o.state == #pending or (switch (o.state) { case (#approved(_)) { true }; case _ { false } }))) { { o with state = #expired } } else { o }) }; case null { null } } };
  /// Ops, newest first; `open` keeps only pending and approved ones.
  public query func list_ops(open : Bool, limit : Nat) : async [T.Op] {
    let now = Time.now();
    let view = func(o : T.Op) : T.Op { if (now > o.staged_at + op_ttl_ns and (switch (o.state) { case (#pending or #approved(_)) { true }; case _ { false } })) { { o with state = #expired } } else { o } };
    let all = Array.map<T.Op, T.Op>(ops, view);
    let picked = if (open) { Array.filter<T.Op>(all, func(o) { switch (o.state) { case (#pending or #approved(_)) { true }; case _ { false } } }) } else { all };
    let rev = Array.reverse(picked);
    if (limit > 0 and rev.size() > limit) { Array.subArray(rev, 0, limit) } else { rev };
  };
  public query func list_ops_for(canister_id : Principal) : async [T.Op] { Array.reverse(Array.filter<T.Op>(ops, func(o) { o.child == canister_id })) };
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
};
