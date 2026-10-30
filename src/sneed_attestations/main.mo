import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Cycles "mo:base/ExperimentalCycles";
import Debug "mo:base/Debug";
import Error "mo:base/Error";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Option "mo:base/Option";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Timer "mo:base/Timer";
import Map "mo:map/Map";

import IngressGuard "../IngressGuard";
import RateLimit "../RateLimit";
import RateRules "../RateRules";
import Hash "../icrc3/Hash";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import TextLog "../sneed_names/TextLog";
import ApiDoc "ApiDoc";
import Live "Live";
import Oh "OhShiiTypes";
import SnsGov "SnsGov";
import T "Types";

/// sneed_attestations: the proposal attestation registry (spec/proposal_attestations.md v3).
///
/// Independent builders (any principal) attest what they rebuilt for a step of a governance
/// proposal, or for a `#release` (an install that is not a proposal). The registry keeps every
/// attestation per builder (newest counts, older ones stay in the ICRC-3 log), never merges them
/// into a score, and checks what it can itself:
/// - it reads each attested proposal through an adapter (SNS `get_proposal`; OhShii ONS/SONS
///   `get_proposal_upgrade_steps`, planned interface) until every step is final;
/// - after a wasm step executes (or is skipped, or restores a snapshot) it reads the target with
///   the management canister's canister_info promptly (the IC keeps only 20 changes): live module
///   hash, and who installed it;
/// - after a frontend step it computes the asset tree hash from the asset canister's `list`.
/// Calls to other DAOs' canisters stay within a per-DAO hourly budget (with back-off), at most a
/// few in flight. Known builders per DAO are set only by that DAO's governance canister and only
/// change highlighting. Controllers maintain it (pause, caps); nobody can alter an attestation.
/// Informational, not a gate.
shared (deployer) persistent actor class SneedAttestations() = this {

  public type Subject = T.Subject;
  public type Artifact = T.Artifact;
  public type Source = T.Source;
  public type Verdict = T.Verdict;
  public type AttestInput = T.AttestInput;
  public type Attestation = T.Attestation;
  public type AttestationView = T.AttestationView;
  public type BuilderProfileInput = T.BuilderProfileInput;
  public type BuilderProfile = T.BuilderProfile;
  public type KnownBuilder = T.KnownBuilder;
  public type SetKnownBuildersArgs = T.SetKnownBuildersArgs;
  public type KnownBuilders = T.KnownBuilders;
  public type ValidationResult = T.ValidationResult;
  public type GovernanceKind = T.GovernanceKind;
  public type ProposalRead = T.ProposalRead;
  public type ProposalStep = T.ProposalStep;
  public type LiveCheck = T.LiveCheck;
  public type ProposalStatus = T.ProposalStatus;
  public type ReleaseStatus = T.ReleaseStatus;
  public type ProposalSummary = T.ProposalSummary;
  public type StepStatus = T.StepStatus;
  public type CallBudget = T.CallBudget;
  public type Config = T.Config;
  public type ConfigUpdate = T.ConfigUpdate;
  public type Limits = T.Limits;
  public type Stats = T.Stats;
  public type LogEntry = T.LogEntry;

  // ---------------------------------------------------------------------------------------------
  // Constants (transient: a changed value takes effect on upgrade)
  // ---------------------------------------------------------------------------------------------

  transient let MAX_REPO : Nat = 512;
  transient let MAX_COMMIT : Nat = 128;
  transient let MAX_RECIPE : Nat = 2_000;
  transient let MAX_ENV : Nat = 512;
  transient let MAX_URL : Nat = 512;
  transient let MAX_REASON : Nat = 1_000;
  transient let MAX_NAME : Nat = 100;
  transient let MAX_DESCRIPTION : Nat = 1_000;
  transient let MAX_NOTE : Nat = 200;
  transient let MAX_EMBEDDED : Nat = 16;
  transient let HASH_BYTES : Nat = 32;
  transient let MAX_SOURCE_TEXT : Nat = 2_000; // per proposal source text kept from a read
  transient let MAX_ERROR_TEXT : Nat = 500;
  transient let MAX_LIVE_FAILURES : Nat = 3;
  transient let MAX_PAGE : Nat = 100;
  transient let MAX_IDS : Nat = 100;
  transient let CALL_TIMEOUT : Nat32 = 60; // seconds, bounded-wait calls to other canisters
  transient let SEC_NS : Int = 1_000_000_000;
  transient let HOUR_NS : Int = 3_600_000_000_000;
  transient let STALE_RUN_NS : Int = 900_000_000_000;
  transient let RETRY_BASE_NS : Int = 300_000_000_000; // 5 min, doubled per failure
  transient let RETRY_MAX_NS : Int = 21_600_000_000_000; // 6 h
  transient let FNS_FRESH_NS : Int = 3_600_000_000_000; // a function list younger than this is trusted for a missing id
  transient let MAINNET_ID = "a5rqn-baaaa-aaaac-bghua-cai";
  transient let STAGING_ID = "xrnbc-uaaaa-aaaac-qhm7a-cai";

  transient let RATE_DEFAULTS : RateRules.Rules = [
    ("attest", { capacity = 30; per_minute = 5 }),
    ("new_subject", { capacity = 20; per_minute = 1 }), // attestations that open a new subject
    ("profile", { capacity = 5; per_minute = 1 }),
  ];

  // ---------------------------------------------------------------------------------------------
  // State (enhanced orthogonal persistence)
  // ---------------------------------------------------------------------------------------------

  var config : Config = {
    paused = false;
    tick_s = 60;
    max_in_flight = 3;
    max_calls_per_tick = 30;
    calls_per_hour_per_dao = 60;
    max_backoff_s = 86_400;
    poll_open_s = 3_600;
    poll_executing_s = 300;
    max_watch_s = 30 * 86_400;
    max_read_failures = 5;
    max_subjects = 20_000;
    max_attestations = 200_000;
    max_builders_per_subject = 64;
    max_versions_per_builder = 5;
    max_steps = 50;
    max_asset_entries = 20_000;
    max_asset_pages = 100;
    max_known_builders = 50;
    max_known_lists = 1_000;
    min_cycles = 1_000_000_000_000;
    sns_wasm = Principal.fromText("qaa6y-5yaaa-aaaaa-aaafa-cai");
    archive_controllers = [];
  };
  var rate_rules : [(Text, RateLimit.Rule)] = [];

  type SubjectRec = {
    subject : Subject;
    created_at : Int;
    by_builder : Map.Map<Principal, [Attestation]>; // oldest first, at most max_versions_per_builder
  };
  let subjects = Map.new<Text, SubjectRec>();
  var attestations_ever : Nat = 0;
  var attestations_stored : Nat = 0;

  type Tracked = {
    governance : Principal;
    proposal_id : Nat64;
    created_at : Int;
    var steps_attested : [Nat];
    var read : ?ProposalRead;
    var read_error : ?Text;
    var reads : Nat;
    var failures : Nat;
    var next_at : Int;
    var reads_done : Bool; // every step is final: no more proposal reads
    var deadline_s : ?Nat64;
    var live : [(Nat, LiveCheck)];
    var live_failures : [(Nat, Nat)];
    var watch : T.WatchState;
  };
  let proposals = Map.new<Text, Tracked>();
  let active = Map.new<Text, ()>(); // proposals being watched

  type ReleaseRec = {
    target : Principal;
    module_hash : Blob;
    created_at : Int;
    var check : ?LiveCheck;
    var failures : Nat;
    var next_at : ?Int; // null: checked (or given up)
  };
  let releases = Map.new<Text, ReleaseRec>();

  type GovRec = {
    governance : Principal;
    var kind : ?GovernanceKind;
    var sns_root : ?Principal;
    var fns : ?[SnsGov.FnTarget];
    var fns_at : Int;
    var fns_wanted : Bool;
    var window_start : Int;
    var calls_in_window : Nat;
    var capped_in_window : Bool;
    var calls_total : Nat;
    var throttled : Nat;
    var backoff_until : ?Int;
    var backoff_level : Nat;
    var known : ?KnownBuilders;
  };
  let govs = Map.new<Principal, GovRec>();
  var known_lists : Nat = 0;
  var sns_roots_at : Int = 0;
  var sns_roots_wanted : Bool = false;

  type ProfileRec = { var profile : ?BuilderProfileInput; var updated_at : Int; var attestations : Nat };
  let builders = Map.new<Principal, ProfileRec>();

  let call_counts = Map.new<Text, Nat>();
  var call_errors : Nat = 0;
  var ticks : Nat = 0;
  var last_tick_at : ?Int = null;
  var live_checks : Nat = 0;

  let textlog : TextLog.State = TextLog.init();
  var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
  transient let limiter = RateLimit.Limiter();

  transient var running : Bool = false;
  transient var run_started : Int = 0;
  transient var kick_pending : Bool = false;
  transient var tick_timer : ?Timer.TimerId = null;
  transient var timers_started : Bool = false;

  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/sneed_attestations#block-types";
    block_types = [
      "sneedatt_attest",
      "sneedatt_live_check",
      "sneedatt_proposal_final",
      "sneedatt_known_builders",
      "sneedatt_builder_profile",
      "sneedatt_governance_kind",
      "sneedatt_config",
    ];
  };

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  func self() : Principal = Principal.fromActor(this);
  func now() : Int = Time.now();
  func nowS() : Nat64 = Nat64.fromNat(Int.abs(now()) / 1_000_000_000);
  func pv(p : Principal) : T3.Value = Icrc3Log.principal(p);
  func hex(b : Blob) : Text = Hash.toHex(b);
  func isController(p : Principal) : Bool = Principal.isController(p);

  func clip(t : Text, max : Nat) : Text {
    if (t.size() <= max) return t;
    var out = "";
    var n = 0;
    label chars for (c in t.chars()) { if (n >= max) break chars; out #= Text.fromChar(c); n += 1 };
    out # "…";
  };

  func logInfo(caller : Principal, m : Text) { TextLog.add(textlog, #info, TextLog.correlationId(textlog), caller, m) };
  func logError(caller : Principal, m : Text) { TextLog.add(textlog, #error, TextLog.correlationId(textlog), caller, m) };

  func subjectKey(s : Subject) : Text = switch s {
    case (#proposal(p)) "p/" # Principal.toText(p.governance) # "/" # Nat64.toText(p.proposal_id) # "/" # Nat.toText(p.step);
    case (#release(r)) "r/" # Principal.toText(r.target) # "/" # hex(r.module_hash);
  };
  func propKey(g : Principal, id : Nat64) : Text = Principal.toText(g) # "/" # Nat64.toText(id);
  func releaseKey(target : Principal, h : Blob) : Text = Principal.toText(target) # "/" # hex(h);
  func propDesc(t : Tracked) : Text = "proposal " # Nat64.toText(t.proposal_id) # " of " # Principal.toText(t.governance);

  func countCall(method : Text) {
    Map.set(call_counts, Map.thash, method, Option.get(Map.get(call_counts, Map.thash, method), 0) + 1);
  };

  func backoff(failures : Nat) : Int {
    var d = RETRY_BASE_NS;
    var i = 1;
    while (i < failures and d < RETRY_MAX_NS) { d *= 2; i += 1 };
    Int.min(d, RETRY_MAX_NS);
  };

  func lookupPair<V>(xs : [(Nat, V)], k : Nat) : ?V = switch (Array.find<(Nat, V)>(xs, func((i, _)) = i == k)) {
    case (?(_, v)) ?v;
    case null null;
  };
  func setPair<V>(xs : [(Nat, V)], k : Nat, v : V) : [(Nat, V)] = Array.append(Array.filter<(Nat, V)>(xs, func((i, _)) = i != k), [(k, v)]);

  // ---------------------------------------------------------------------------------------------
  // ICRC-3 log
  // ---------------------------------------------------------------------------------------------

  func icrc3_env() : Icrc3Log.Environment {
    {
      self = self();
      archive_controllers = config.archive_controllers;
      cycle_reserve = 1_000_000_000_000;
      new_correlation_id = func() : Nat = TextLog.correlationId(textlog);
      log_info = func(cid : Nat, m : Text) = TextLog.add(textlog, #info, cid, self(), m);
      log_error = func(cid : Nat, m : Text) = TextLog.add(textlog, #error, cid, self(), m);
    };
  };

  func block(btype : Text, caller : Principal, tx : [(Text, T3.Value)]) : Nat {
    Icrc3Log.append(icrc3, "sneedatt_" # btype, Int.abs(now()), Array.append<(Text, T3.Value)>([("caller", pv(caller))], tx));
  };

  func optField(b : Buffer.Buffer<(Text, T3.Value)>, k : Text, v : ?T3.Value) { switch v { case (?x) b.add((k, x)); case null {} } };
  func blobV(o : ?Blob) : ?T3.Value = Option.map<Blob, T3.Value>(o, func(x) = #Blob(x));
  func textV(o : ?Text) : ?T3.Value = Option.map<Text, T3.Value>(o, func(x) = #Text(x));

  func subjectValue(s : Subject) : T3.Value = switch s {
    case (#proposal(p)) #Map([("kind", #Text("proposal")), ("governance", pv(p.governance)), ("proposal_id", Icrc3Log.nat64(p.proposal_id)), ("step", #Nat(p.step))]);
    case (#release(r)) #Map([("kind", #Text("release")), ("target", pv(r.target)), ("module_hash", #Blob(r.module_hash))]);
  };

  func artifactValue(a : Artifact) : T3.Value {
    let b = Buffer.Buffer<(Text, T3.Value)>(8);
    switch a {
      case (#wasm(w)) {
        b.add(("kind", #Text("wasm")));
        b.add(("target", pv(w.target)));
        b.add(("proposed_sha256", #Blob(w.proposed_sha256)));
        b.add(("built_raw_sha256", #Blob(w.built_raw_sha256)));
        optField(b, "built_gz_sha256", blobV(w.built_gz_sha256));
        if (w.embedded.size() > 0) b.add(("embedded", #Array(Array.map<T.Embedded, T3.Value>(w.embedded, func(e) = #Map([("name", #Text(e.name)), ("sha256", #Blob(e.sha256))])))));
        optField(b, "upgrade_arg_sha256", blobV(w.upgrade_arg_sha256));
      };
      case (#asset_batch(x)) {
        b.add(("kind", #Text("asset_batch")));
        b.add(("target", pv(x.target)));
        b.add(("batch_id", #Nat(x.batch_id)));
        b.add(("proposed_evidence", #Blob(x.proposed_evidence)));
        optField(b, "built_evidence", blobV(x.built_evidence));
        b.add(("tree_sha256", #Blob(x.tree_sha256)));
      };
    };
    #Map(Buffer.toArray(b));
  };

  func sourceValue(s : Source) : T3.Value {
    let b = Buffer.Buffer<(Text, T3.Value)>(4);
    b.add(("repo", #Text(s.repo)));
    b.add(("commit", #Text(s.commit)));
    b.add(("recipe", #Text(s.recipe)));
    optField(b, "environment", textV(s.environment));
    #Map(Buffer.toArray(b));
  };

  func verdictText(v : Verdict) : Text = switch v { case (#match) "match"; case (#mismatch) "mismatch"; case (#cannot_verify _) "cannot_verify" };
  func kindText(k : GovernanceKind) : Text = switch k { case (#sns) "sns"; case (#ohshii) "ohshii" };
  func roleText(r : T.InstallerRole) : Text = switch r {
    case (#governance) "governance";
    case (#dao_root) "dao_root";
    case (#other_canister) "other_canister";
    case (#user) "user";
  };
  func executionText(e : T.Execution) : Text = switch e {
    case (#pending) "pending";
    case (#not_executed) "not_executed";
    case (#in_progress) "in_progress";
    case (#executed _) "executed";
    case (#skipped _) "skipped";
    case (#failed _) "failed";
    case (#unknown) "unknown";
  };

  func liveValue(subject : T3.Value, c : LiveCheck) : [(Text, T3.Value)] {
    let b = Buffer.Buffer<(Text, T3.Value)>(12);
    b.add(("subject", subject));
    switch (c.target) { case (?t) b.add(("target", pv(t))); case null {} };
    switch (c.result) {
      case (#live_match) b.add(("result", #Text("live_match")));
      case (#live_mismatch(m)) { b.add(("result", #Text("live_mismatch"))); b.add(("reason", #Text(m))) };
      case (#asset_tree(x)) {
        b.add(("result", #Text("asset_tree")));
        b.add(("tree_sha256", #Blob(x.tree_sha256)));
        b.add(("identity_tree_sha256", #Blob(x.identity_tree_sha256)));
        b.add(("assets", #Nat(x.assets)));
        b.add(("encodings", #Nat(x.encodings)));
      };
      case (#snapshot_restored(x)) {
        b.add(("result", #Text("snapshot_restored")));
        optField(b, "before", blobV(x.before));
        optField(b, "after", blobV(x.after));
        optField(b, "snapshot_id", blobV(x.snapshot_id));
      };
      case (#not_checked(m)) { b.add(("result", #Text("not_checked"))); b.add(("reason", #Text(m))) };
    };
    optField(b, "compared_with", blobV(c.compared_with));
    optField(b, "module_hash", blobV(c.module_hash));
    switch (c.installed_by) {
      case (?i) {
        b.add(("installed_by", pv(i.principal)));
        b.add(("installer_role", #Text(roleText(i.role))));
        b.add(("installed_at", Icrc3Log.nat64(i.at_ns)));
      };
      case null {};
    };
    if (c.skipped) b.add(("skipped", #Nat(1)));
    Buffer.toArray(b);
  };

  // ---------------------------------------------------------------------------------------------
  // Rate limits
  // ---------------------------------------------------------------------------------------------

  func rateRule(action : Text) : RateLimit.Rule = RateRules.rule(rate_rules, RATE_DEFAULTS, action);
  func rateTake(caller : Principal, action : Text) : Bool = isController(caller) or limiter.take(caller, action, rateRule(action), now());
  func rateAllows(caller : Principal, action : Text) : Bool = isController(caller) or limiter.allows(caller, action, rateRule(action), now());

  // ---------------------------------------------------------------------------------------------
  // Attesting
  // ---------------------------------------------------------------------------------------------

  func hashOk(b : Blob) : Bool = b.size() == HASH_BYTES;
  func optHashOk(b : ?Blob) : Bool = switch b { case (?x) hashOk(x); case null true };
  func textOk(t : Text, min : Nat, max : Nat) : Bool = t.size() >= min and t.size() <= max;

  /// Why an attestation is refused (sizes and consistency), or null.
  func checkInput(a : AttestInput) : ?Text {
    switch (a.subject) {
      case (#proposal(p)) {
        if (Principal.isAnonymous(p.governance)) return ?"The governance canister can't be the anonymous principal";
        if (p.step >= config.max_steps) return ?("step must be below " # Nat.toText(config.max_steps));
      };
      case (#release(r)) {
        if (not hashOk(r.module_hash)) return ?"module_hash must be 32 bytes";
        switch (a.artifact) {
          case (#wasm(w)) {
            if (w.target != r.target) return ?"A release's artifact target must be the release's target";
            if (w.proposed_sha256 != r.module_hash) return ?"A release's proposed_sha256 must be the release's module_hash";
          };
          case (#asset_batch _) return ?"A release is a wasm install: use a wasm artifact";
        };
      };
    };
    switch (a.artifact) {
      case (#wasm(w)) {
        if (not hashOk(w.proposed_sha256) or not hashOk(w.built_raw_sha256) or not optHashOk(w.built_gz_sha256) or not optHashOk(w.upgrade_arg_sha256)) return ?"Hashes must be 32 bytes (sha256)";
        if (w.embedded.size() > MAX_EMBEDDED) return ?("At most " # Nat.toText(MAX_EMBEDDED) # " embedded modules");
        for (e in w.embedded.vals()) {
          if (not textOk(e.name, 1, MAX_NAME)) return ?("Embedded module names must be 1-" # Nat.toText(MAX_NAME) # " characters");
          if (not hashOk(e.sha256)) return ?"Hashes must be 32 bytes (sha256)";
        };
      };
      case (#asset_batch(x)) {
        if (not hashOk(x.proposed_evidence) or not optHashOk(x.built_evidence) or not hashOk(x.tree_sha256)) return ?"Evidence and tree hashes must be 32 bytes";
      };
    };
    if (not textOk(a.source.repo, 1, MAX_REPO)) return ?("source.repo must be 1-" # Nat.toText(MAX_REPO) # " characters");
    if (not textOk(a.source.commit, 1, MAX_COMMIT)) return ?("source.commit must be 1-" # Nat.toText(MAX_COMMIT) # " characters");
    if (not textOk(a.source.recipe, 1, MAX_RECIPE)) return ?("source.recipe must be 1-" # Nat.toText(MAX_RECIPE) # " characters");
    if (not IngressGuard.optText(a.source.environment, MAX_ENV)) return ?("source.environment: at most " # Nat.toText(MAX_ENV) # " characters");
    if (not IngressGuard.optText(a.log_url, MAX_URL)) return ?("log_url: at most " # Nat.toText(MAX_URL) # " characters");
    switch (a.verdict) { case (#cannot_verify(r)) if (r.size() > MAX_REASON) return ?("The cannot_verify reason: at most " # Nat.toText(MAX_REASON) # " characters"); case _ {} };
    null;
  };

  func govRec(g : Principal) : GovRec {
    switch (Map.get(govs, Map.phash, g)) {
      case (?r) r;
      case null {
        let r : GovRec = {
          governance = g;
          var kind = null;
          var sns_root = null;
          var fns = null;
          var fns_at = 0;
          var fns_wanted = false;
          var window_start = 0;
          var calls_in_window = 0;
          var capped_in_window = false;
          var calls_total = 0;
          var throttled = 0;
          var backoff_until = null;
          var backoff_level = 0;
          var known = null;
        };
        Map.set(govs, Map.phash, g, r);
        r;
      };
    };
  };

  func isKnown(g : Principal, b : Principal) : Bool = switch (Map.get(govs, Map.phash, g)) {
    case (?r) switch (r.known) {
      case (?k) Array.find<KnownBuilder>(k.builders, func(x) = x.builder == b) != null;
      case null false;
    };
    case null false;
  };

  func subjectGovernance(s : Subject) : ?Principal = switch s { case (#proposal(p)) ?p.governance; case (#release _) null };

  func kick<system>() {
    if (kick_pending or config.paused) return;
    kick_pending := true;
    ignore Timer.setTimer<system>(#seconds 1, tickJob);
  };

  /// Attest what you rebuilt for one subject. The caller is the builder; the IC's signature on
  /// this call is the attestation. Attesting again for the same subject replaces your current one
  /// (older ones stay in the ICRC-3 log, and up to max_versions_per_builder in state).
  public shared ({ caller }) func attest(a : AttestInput) : async T.Result<{ id : Nat; block : Nat }> {
    if (Principal.isAnonymous(caller)) return #err("Sign in: the anonymous principal can't attest");
    if (not rateTake(caller, "attest")) return #err("Rate limited: too many attestations, try again in a minute");
    switch (checkInput(a)) { case (?e) return #err(e); case null {} };
    let key = subjectKey(a.subject);
    let gov = subjectGovernance(a.subject);
    let known = switch gov { case (?g) isKnown(g, caller); case null false };
    let rec = switch (Map.get(subjects, Map.thash, key)) {
      case (?r) r;
      case null {
        if (Map.size(subjects) >= config.max_subjects) return #err("The registry holds its maximum number of subjects; ask its controllers");
        if (not rateTake(caller, "new_subject")) return #err("Rate limited: too many new subjects, try again later");
        let r : SubjectRec = { subject = a.subject; created_at = now(); by_builder = Map.new<Principal, [Attestation]>() };
        Map.set(subjects, Map.thash, key, r);
        r;
      };
    };
    let prev = Option.get(Map.get(rec.by_builder, Map.phash, caller), []);
    if (prev.size() == 0 and Map.size(rec.by_builder) >= config.max_builders_per_subject and not known) {
      return #err("This subject has attestations from " # Nat.toText(Map.size(rec.by_builder)) # " builders, the maximum (known builders of the DAO are still admitted)");
    };
    if (attestations_stored >= config.max_attestations and prev.size() < config.max_versions_per_builder) {
      return #err("The registry holds its maximum number of attestations; ask its controllers");
    };

    let id = attestations_ever;
    attestations_ever += 1;
    let tx = Buffer.Buffer<(Text, T3.Value)>(8);
    tx.add(("id", #Nat(id)));
    tx.add(("subject", subjectValue(a.subject)));
    tx.add(("artifact", artifactValue(a.artifact)));
    tx.add(("source", sourceValue(a.source)));
    tx.add(("verdict", #Text(verdictText(a.verdict))));
    switch (a.verdict) { case (#cannot_verify(r)) tx.add(("reason", #Text(r))); case _ {} };
    optField(tx, "log_url", textV(a.log_url));
    let index = block("attest", caller, Buffer.toArray(tx));
    let att : Attestation = { id; block = index; subject = a.subject; artifact = a.artifact; source = a.source; verdict = a.verdict; log_url = a.log_url; builder = caller; at = now() };

    // newest last; the oldest versions beyond the cap leave state (they stay in the log)
    var versions = Array.append(prev, [att]);
    attestations_stored += 1;
    while (versions.size() > config.max_versions_per_builder and versions.size() > 1) {
      versions := Array.subArray<Attestation>(versions, 1, versions.size() - 1);
      attestations_stored -= 1;
    };
    Map.set(rec.by_builder, Map.phash, caller, versions);
    switch (Map.get(builders, Map.phash, caller)) {
      case (?p) p.attestations += 1;
      case null { let pr : ProfileRec = { var profile = null; var updated_at = 0; var attestations = 1 }; Map.set(builders, Map.phash, caller, pr) };
    };

    // watch it
    switch (a.subject) {
      case (#proposal(p)) {
        ignore govRec(p.governance);
        let pk = propKey(p.governance, p.proposal_id);
        switch (Map.get(proposals, Map.thash, pk)) {
          case (?t) if (Array.find<Nat>(t.steps_attested, func(s) = s == p.step) == null) t.steps_attested := Array.append(t.steps_attested, [p.step]);
          case null {
            let t : Tracked = {
              governance = p.governance;
              proposal_id = p.proposal_id;
              created_at = now();
              var steps_attested = [p.step];
              var read = null;
              var read_error = null;
              var reads = 0;
              var failures = 0;
              var next_at = now();
              var reads_done = false;
              var deadline_s = null;
              var live = [];
              var live_failures = [];
              var watch = #watching;
            };
            Map.set(proposals, Map.thash, pk, t);
            Map.set(active, Map.thash, pk, ());
            logInfo(caller, "Watching " # propDesc(t) # " (first attestation " # Nat.toText(id) # ")");
          };
        };
      };
      case (#release(r)) {
        let rk = releaseKey(r.target, r.module_hash);
        if (not Map.has(releases, Map.thash, rk)) {
          let rr : ReleaseRec = { target = r.target; module_hash = r.module_hash; created_at = now(); var check = null; var failures = 0; var next_at = ?now() };
          Map.set(releases, Map.thash, rk, rr);
          logInfo(caller, "Release " # rk # ": live check queued (attestation " # Nat.toText(id) # ")");
        };
      };
    };
    logInfo(caller, "Attestation " # Nat.toText(id) # " for " # key # ": " # verdictText(a.verdict) # " (block " # Nat.toText(index) # ", version " # Nat.toText(versions.size()) # ")");
    kick<system>();
    #ok({ id; block = index });
  };

  // ---------------------------------------------------------------------------------------------
  // Builder profiles
  // ---------------------------------------------------------------------------------------------

  public shared ({ caller }) func set_builder_profile(p : BuilderProfileInput) : async T.Result<()> {
    if (Principal.isAnonymous(caller)) return #err("Sign in: the anonymous principal has no profile");
    if (not rateTake(caller, "profile")) return #err("Rate limited: try again in a minute");
    if (not textOk(p.name, 1, MAX_NAME)) return #err("name must be 1-" # Nat.toText(MAX_NAME) # " characters");
    if (not IngressGuard.optText(p.contact, MAX_URL) or not IngressGuard.optText(p.repo, MAX_URL)) return #err("contact and repo: at most " # Nat.toText(MAX_URL) # " characters");
    if (not IngressGuard.optText(p.description, MAX_DESCRIPTION)) return #err("description: at most " # Nat.toText(MAX_DESCRIPTION) # " characters");
    if (not Map.has(builders, Map.phash, caller) and Map.size(builders) >= config.max_subjects) return #err("The registry holds its maximum number of builders");
    switch (Map.get(builders, Map.phash, caller)) {
      case (?r) { r.profile := ?p; r.updated_at := now() };
      case null { let pr : ProfileRec = { var profile = ?p; var updated_at = now(); var attestations = 0 }; Map.set(builders, Map.phash, caller, pr) };
    };
    let tx = Buffer.Buffer<(Text, T3.Value)>(4);
    tx.add(("name", #Text(p.name)));
    optField(tx, "contact", textV(p.contact));
    optField(tx, "repo", textV(p.repo));
    optField(tx, "description", textV(p.description));
    ignore block("builder_profile", caller, Buffer.toArray(tx));
    logInfo(caller, "Builder profile set: " # p.name);
    #ok(());
  };

  func profileOf(b : Principal) : ?BuilderProfile = switch (Map.get(builders, Map.phash, b)) {
    case (?r) switch (r.profile) {
      case (?p) ?{ builder = b; name = p.name; contact = p.contact; repo = p.repo; description = p.description; updated_at = r.updated_at; attestations = r.attestations };
      case null null;
    };
    case null null;
  };

  // ---------------------------------------------------------------------------------------------
  // Known builders: per DAO, set by that DAO's governance canister (a GNSF proposal for an SNS)
  // ---------------------------------------------------------------------------------------------

  func checkKnown(caller : Principal, args : SetKnownBuildersArgs) : T.Result<Text> {
    if (Principal.isAnonymous(caller)) return #err("The anonymous principal has no known-builders list");
    if (args.builders.size() > config.max_known_builders) return #err("At most " # Nat.toText(config.max_known_builders) # " known builders");
    let seen = Buffer.Buffer<Principal>(args.builders.size());
    for (k in args.builders.vals()) {
      if (Principal.isAnonymous(k.builder)) return #err("The anonymous principal can't be a known builder");
      if (Buffer.contains<Principal>(seen, k.builder, Principal.equal)) return #err(Principal.toText(k.builder) # " is listed twice");
      if (not IngressGuard.optText(k.note, MAX_NOTE)) return #err("Notes: at most " # Nat.toText(MAX_NOTE) # " characters");
      seen.add(k.builder);
    };
    let old = switch (Map.get(govs, Map.phash, caller)) { case (?r) switch (r.known) { case (?k) k.builders; case null [] }; case null [] };
    if (known_lists >= config.max_known_lists and (switch (Map.get(govs, Map.phash, caller)) { case (?r) r.known == null; case null true })) {
      return #err("The registry holds its maximum number of known-builder lists");
    };
    let lines = Buffer.Buffer<Text>(args.builders.size() + 4);
    lines.add("Sneed attestation registry (" # Principal.toText(self()) # "): known builders of " # Principal.toText(caller) # ", " # Nat.toText(args.builders.size()) # " in all.");
    lines.add("Only changes which builders frontends highlight; never what the registry records.");
    for (k in args.builders.vals()) {
      let name = switch (profileOf(k.builder)) { case (?p) " \"" # p.name # "\""; case null "" };
      let note = switch (k.note) { case (?n) " · " # n; case null "" };
      let tag = if (Array.find<KnownBuilder>(old, func(o) = o.builder == k.builder) == null) "Add: " else "Keep: ";
      lines.add(tag # Principal.toText(k.builder) # name # note);
    };
    for (o in old.vals()) {
      if (Array.find<KnownBuilder>(args.builders, func(k) = k.builder == o.builder) == null) lines.add("Remove: " # Principal.toText(o.builder));
    };
    #ok(Text.join("\n", lines.vals()));
  };

  /// The GNSF validator for set_known_builders (SNS style): what the list of the calling governance
  /// would become. Governance calls it with the proposal's payload; its caller is the governance.
  public shared query ({ caller }) func validate_set_known_builders(args : SetKnownBuildersArgs) : async ValidationResult {
    switch (checkKnown(caller, args)) { case (#ok(t)) #Ok(t); case (#err(e)) #Err(e) };
  };

  /// Replaces the known-builders list of the caller: only a DAO's governance canister calling for
  /// itself (an SNS: a generic nervous system function with validate_set_known_builders). Traps on
  /// a refusal, so governance marks the proposal failed.
  public shared ({ caller }) func set_known_builders(args : SetKnownBuildersArgs) : async Text {
    let text = switch (checkKnown(caller, args)) { case (#ok(t)) t; case (#err(e)) Debug.trap(e) };
    let g = govRec(caller);
    if (g.known == null) known_lists += 1;
    let index = block("known_builders", caller, [
      ("builders", #Array(Array.map<KnownBuilder, T3.Value>(args.builders, func(k) = switch (k.note) {
        case (?n) #Map([("builder", pv(k.builder)), ("note", #Text(n))]);
        case null #Map([("builder", pv(k.builder))]);
      }))),
    ]);
    g.known := ?{ governance = caller; builders = args.builders; set_at = now(); block = index };
    logInfo(caller, "Known builders of " # Principal.toText(caller) # " set: " # Nat.toText(args.builders.size()) # " (block " # Nat.toText(index) # ")");
    text;
  };

  // ---------------------------------------------------------------------------------------------
  // Per-DAO call budget (spec: OhShii bills replicated reads; the registry keeps to its budget)
  // ---------------------------------------------------------------------------------------------

  func pow2(n : Nat) : Int { var p : Int = 1; var i = 0; while (i < n and i < 30) { p *= 2; i += 1 }; p };

  /// Takes one call from the DAO's hourly budget, or refuses (and backs off) when it is spent.
  /// A window is an hour from its first call. Reaching the cap backs the DAO off until the next
  /// window, then twice as long each consecutive time, up to max_backoff_s.
  func budgetTake(g : GovRec, what : Text) : Bool {
    let t = now();
    switch (g.backoff_until) { case (?u) if (t < u) return false else g.backoff_until := null; case null {} };
    if (t - g.window_start >= HOUR_NS) {
      if (not g.capped_in_window) g.backoff_level := 0;
      g.window_start := t;
      g.calls_in_window := 0;
      g.capped_in_window := false;
    };
    if (g.calls_in_window >= config.calls_per_hour_per_dao) {
      if (not g.capped_in_window) {
        g.capped_in_window := true;
        g.throttled += 1;
        g.backoff_level += 1;
        let wait = Int.min(HOUR_NS * pow2(g.backoff_level - 1), config.max_backoff_s * SEC_NS);
        g.backoff_until := ?(g.window_start + wait);
        logError(self(), "Call budget of " # Principal.toText(g.governance) # " reached (" # Nat.toText(config.calls_per_hour_per_dao) # " calls/hour, at " # what # "): backing off for " # Int.toText(wait / SEC_NS) # " s");
      };
      return false;
    };
    g.calls_in_window += 1;
    g.calls_total += 1;
    true;
  };


  // ---------------------------------------------------------------------------------------------
  // Polling: jobs, run by a recurring timer with at most max_in_flight calls in flight
  // ---------------------------------------------------------------------------------------------

  type StepRef = { key : Text; step : Nat };

  transient let mgmt : Live.Management = actor ("aaaaa-aa");
  func snsGov(g : Principal) : SnsGov.Governance = actor (Principal.toText(g));
  func ohGov(g : Principal) : Oh.Governance = actor (Principal.toText(g));
  func assetsOf(c : Principal) : Live.Assets = actor (Principal.toText(c));

  func step(t : Tracked, i : Nat) : ?ProposalStep = switch (t.read) {
    case (?r) Array.find<ProposalStep>(r.steps, func(s) = s.index == i);
    case null null;
  };

  /// Newest attestation of each builder for a subject.
  func newest(key : Text) : [Attestation] = switch (Map.get(subjects, Map.thash, key)) {
    case (?r) {
      let out = Buffer.Buffer<Attestation>(Map.size(r.by_builder));
      for (vs in Map.vals(r.by_builder)) if (vs.size() > 0) out.add(vs[vs.size() - 1]);
      Buffer.toArray(out);
    };
    case null [];
  };

  /// Whether one of the DAO's known builders attested a step of this proposal.
  func hasKnownAttestation(t : Tracked) : Bool {
    for (i in t.steps_attested.vals()) {
      for (a in newest(subjectKey(#proposal({ governance = t.governance; proposal_id = t.proposal_id; step = i }))).vals()) {
        if (isKnown(t.governance, a.builder)) return true;
      };
    };
    false;
  };

  /// The hash a wasm step's live module is compared with: the proposal's, else the one all its
  /// builders read (when they agree).
  func expectedHash(t : Tracked, s : ProposalStep) : ?Blob {
    switch (s.artifact) { case (#wasm(w)) switch (w.module_hash) { case (?h) return ?h; case null {} }; case _ return null };
    var h : ?Blob = null;
    for (a in newest(subjectKey(#proposal({ governance = t.governance; proposal_id = t.proposal_id; step = s.index }))).vals()) {
      switch (a.artifact) {
        case (#wasm(w)) switch h { case null h := ?w.proposed_sha256; case (?x) if (x != w.proposed_sha256) return null };
        case _ {};
      };
    };
    h;
  };

  /// Whether a step still needs the registry's own check, and of which kind.
  func liveNeed(t : Tracked, s : ProposalStep) : { #none; #info; #assets } {
    if (lookupPair(t.live, s.index) != null) return #none;
    if (Option.get(lookupPair(t.live_failures, s.index), 0) >= MAX_LIVE_FAILURES) return #none;
    if (s.target == null) return #none;
    switch (s.execution) {
      case (#executed _ or #skipped _) switch (s.artifact) { case (#asset_batch _) #assets; case _ #info };
      case _ #none;
    };
  };


  /// Up to `n` jobs, most urgent first: SNS roots (installer roles), live checks, releases,
  /// function lists, proposal reads. Budgeted calls take from the DAO's budget here.

  // ---- processing replies ----

  func readFailed(t : Tracked, m : Text) {
    t.failures += 1;
    t.read_error := ?clip("cannot read proposal: " # m, MAX_ERROR_TEXT);
    t.next_at := now() + backoff(t.failures);
    call_errors += 1;
    logError(self(), "Cannot read " # propDesc(t) # " (" # Nat.toText(t.failures) # "/" # Nat.toText(config.max_read_failures) # "): " # clip(m, MAX_ERROR_TEXT));
    if (t.failures >= config.max_read_failures) stop(t, "cannot read proposal after " # Nat.toText(t.failures) # " attempts: " # clip(m, 200));
  };

  func finalBlock(t : Tracked, outcome : Text) {
    let steps = switch (t.read) { case (?r) r.steps; case null [] };
    ignore block("proposal_final", self(), [
      ("governance", pv(t.governance)),
      ("proposal_id", Icrc3Log.nat64(t.proposal_id)),
      ("outcome", #Text(outcome)),
      ("steps", #Array(Array.map<ProposalStep, T3.Value>(steps, func(s) {
        let b = Buffer.Buffer<(Text, T3.Value)>(5);
        b.add(("step", #Nat(s.index)));
        switch (s.target) { case (?x) b.add(("target", pv(x))); case null {} };
        b.add(("execution", #Text(executionText(s.execution))));
        switch (s.artifact) {
          case (#wasm(w)) optField(b, "module_hash", blobV(w.module_hash));
          case (#asset_batch(x)) optField(b, "evidence", blobV(x.evidence));
          case (#snapshot_restore(x)) optField(b, "snapshot_id", blobV(x.snapshot_id));
          case (#unknown(_)) {};
        };
        #Map(Buffer.toArray(b));
      }))),
    ]);
  };

  func stop(t : Tracked, why : Text) {
    t.watch := #stopped(why);
    t.reads_done := true;
    Map.delete(active, Map.thash, propKey(t.governance, t.proposal_id));
    finalBlock(t, "stopped: " # why);
    logInfo(self(), "Stopped watching " # propDesc(t) # ": " # why);
  };

  func maybeDone(t : Tracked) {
    if (not t.reads_done or t.watch != #watching) return;
    let r = switch (t.read) { case (?r) r; case null return };
    for (s in r.steps.vals()) {
      if (lookupPair(t.live, s.index) == null and Option.get(lookupPair(t.live_failures, s.index), 0) < MAX_LIVE_FAILURES) return;
    };
    t.watch := #done;
    Map.delete(active, Map.thash, propKey(t.governance, t.proposal_id));
    finalBlock(t, "done");
    logInfo(self(), "Done with " # propDesc(t) # ": every step final and checked");
  };

  func recordLive(t : Tracked, i : Nat, c : LiveCheck) {
    let s = #proposal({ governance = t.governance; proposal_id = t.proposal_id; step = i });
    let index = block("live_check", self(), liveValue(subjectValue(s), c));
    t.live := setPair(t.live, i, { c with block = ?index });
    live_checks += 1;
    let what = switch (c.result) {
      case (#live_match) "live match";
      case (#live_mismatch(m)) "live mismatch: " # m;
      case (#asset_tree(x)) "asset tree " # hex(x.tree_sha256) # " (" # Nat.toText(x.assets) # " assets)";
      case (#snapshot_restored(_)) "snapshot restored";
      case (#not_checked(m)) "not checked: " # m;
    };
    logInfo(self(), "Live check of step " # Nat.toText(i) # " of " # propDesc(t) # ": " # what # (switch (c.installed_by) { case (?x) " · installed by " # Principal.toText(x.principal) # " (" # roleText(x.role) # ")"; case null "" }) # " · block " # Nat.toText(index));
  };

  /// After a read: record the checks that need no call (failed / not executed / unreadable
  /// artifact) and schedule the next read.
  func afterRead(t : Tracked, r : ProposalRead, phase : { #open; #executing; #final }, deadline : ?Nat64) {
    t.read := ?r;
    t.read_error := null;
    t.failures := 0;
    t.reads += 1;
    t.deadline_s := deadline;
    let t0 = now();
    if (r.steps.size() == 0) {
      stop(t, "not an upgrade proposal" # (switch (r.proposal_kind) { case (?k) " (" # k # ")"; case null "" }));
      return;
    };
    for (s in r.steps.vals()) if (lookupPair(t.live, s.index) == null) {
      let none = func(m : Text) { recordLive(t, s.index, { at = t0; target = s.target; result = #not_checked(m); compared_with = null; module_hash = null; installed_by = null; skipped = false; history_changes = 0; block = null }) };
      switch (s.execution) {
        case (#failed(f)) none("the step failed: " # clip(f.error, MAX_ERROR_TEXT));
        case (#not_executed) if (phase == #final) none("the step was not executed");
        case _ if (s.target == null and phase == #final) none("the proposal names no target for this step");
      };
    };
    switch phase {
      case (#final) { t.reads_done := true };
      case (#executing) { t.next_at := t0 + config.poll_executing_s * SEC_NS };
      case (#open) {
        var next = t0 + config.poll_open_s * SEC_NS;
        switch deadline {
          case (?d) {
            let after = Nat64.toNat(d) * SEC_NS + 60 * SEC_NS; // a minute after voting closes
            if (after > t0 and after < next) next := after;
            if (after <= t0) next := t0 + config.poll_executing_s * SEC_NS;
          };
          case null {};
        };
        t.next_at := next;
      };
    };
    if (phase != #final and t0 - t.created_at > config.max_watch_s * SEC_NS) {
      stop(t, "still not final after " # Nat.toText(config.max_watch_s / 86_400) # " days");
      return;
    };
    maybeDone(t);
  };

  func processSns(k : Text, resp : SnsGov.GetProposalResponse) {
    let t = switch (Map.get(proposals, Map.thash, k)) { case (?t) t; case null return };
    let g = govRec(t.governance);
    switch (resp.result) {
      case (?#Proposal(p)) {
        if (g.kind == null) setKind(g, #sns, "read get_proposal");
        if (g.sns_root == null) sns_roots_wanted := true;
        let r = SnsGov.read(p, g.fns, nowS());
        switch (r.needs_functions) {
          case (?_) if (g.fns == null or now() - g.fns_at >= FNS_FRESH_NS) {
            // learn the function's target first, then read again
            g.fns_wanted := true;
            t.next_at := now();
            return;
          };
          case null {};
        };
        let phase = if (r.status == "open") #open else if (r.status == "adopted") #executing else #final;
        afterRead(t, { kind = #sns; proposal_kind = r.proposal_kind; status = r.status; executed_at = r.executed_at; steps = r.steps; read_at = now() }, phase, r.deadline_s);
      };
      // a definitive answer (e.g. no such proposal): not retried (a controller can admin_recheck)
      case (?#Error(e)) {
        t.read_error := ?clip("cannot read proposal: get_proposal: " # e.error_message, MAX_ERROR_TEXT);
        t.reads += 1;
        stop(t, "governance answered: " # clip(e.error_message, 200));
      };
      case null readFailed(t, "get_proposal returned no result");
    };
  };

  func processOh(t : Tracked, steps : ?Oh.ProposalUpgradeSteps) {
    let g = govRec(t.governance);
    if (g.kind == null) setKind(g, #ohshii, "read get_proposal_upgrade_steps");
    switch steps {
      case null {
        t.read := ?{ kind = #ohshii; proposal_kind = null; status = "not an upgrade proposal"; executed_at = null; steps = []; read_at = now() };
        t.read_error := null;
        t.reads += 1;
        stop(t, "not an upgrade proposal (get_proposal_upgrade_steps returned null)");
      };
      case (?p) {
        let s = Oh.steps(p, config.max_steps, MAX_SOURCE_TEXT);
        let phase = Oh.overall(s);
        let status = switch (p.status) { case (?x) x; case null switch phase { case (#open) "open"; case (#executing) "executing"; case (#final) "final" } };
        afterRead(t, { kind = #ohshii; proposal_kind = p.kind; status; executed_at = p.executed_at; steps = s; read_at = now() }, phase, null);
      };
    };
  };

  func setKind(g : GovRec, k : GovernanceKind, how : Text) {
    g.kind := ?k;
    ignore block("governance_kind", self(), [("governance", pv(g.governance)), ("kind", #Text(kindText(k))), ("how", #Text(how))]);
    logInfo(self(), "Governance " # Principal.toText(g.governance) # " is " # kindText(k) # " (" # how # ")");
  };

  func liveFailed(t : Tracked, i : Nat, m : Text) {
    let n = Option.get(lookupPair(t.live_failures, i), 0) + 1;
    t.live_failures := setPair(t.live_failures, i, n);
    call_errors += 1;
    logError(self(), "Live check of step " # Nat.toText(i) # " of " # propDesc(t) # " failed (" # Nat.toText(n) # "/" # Nat.toText(MAX_LIVE_FAILURES) # "): " # clip(m, MAX_ERROR_TEXT));
    if (n >= MAX_LIVE_FAILURES) {
      let s = step(t, i);
      recordLive(t, i, { at = now(); target = Option.chain<ProposalStep, Principal>(s, func(x) = x.target); result = #not_checked("could not check after " # Nat.toText(n) # " attempts: " # clip(m, 200)); compared_with = null; module_hash = null; installed_by = null; skipped = false; history_changes = 0; block = null });
      maybeDone(t);
    };
  };

  func processInfo(ref : StepRef, info : Live.CanisterInfo) {
    let t = switch (Map.get(proposals, Map.thash, ref.key)) { case (?t) t; case null return };
    let s = switch (step(t, ref.step)) { case (?s) s; case null return };
    let g = govRec(t.governance);
    let skipped = switch (s.execution) { case (#skipped _) true; case _ false };
    let (result, by, compared) = switch (s.artifact) {
      case (#snapshot_restore(x)) {
        let (r, i) = Live.checkSnapshot(info, x.snapshot_id, ?t.governance, g.sns_root);
        (r, i, null);
      };
      case _ {
        let exp = expectedHash(t, s);
        let (r, i) = Live.checkWasm(info, exp, ?t.governance, g.sns_root);
        (r, i, exp);
      };
    };
    recordLive(t, ref.step, { at = now(); target = s.target; result; compared_with = compared; module_hash = info.module_hash; installed_by = by; skipped; history_changes = info.recent_changes.size(); block = null });
    maybeDone(t);
  };

  func processRelease(k : Text, info : Live.CanisterInfo) {
    let r = switch (Map.get(releases, Map.thash, k)) { case (?r) r; case null return };
    let (result, by) = Live.checkWasm(info, ?r.module_hash, null, null);
    let c : LiveCheck = { at = now(); target = ?r.target; result; compared_with = ?r.module_hash; module_hash = info.module_hash; installed_by = by; skipped = false; history_changes = info.recent_changes.size(); block = null };
    let index = block("live_check", self(), liveValue(subjectValue(#release({ target = r.target; module_hash = r.module_hash })), c));
    r.check := ?{ c with block = ?index };
    r.next_at := null;
    live_checks += 1;
    logInfo(self(), "Release " # k # ": " # (switch result { case (#live_match) "live"; case (#live_mismatch(m)) "not live: " # m; case _ "checked" }) # " · block " # Nat.toText(index));
  };

  func releaseFailed(k : Text, m : Text) {
    switch (Map.get(releases, Map.thash, k)) {
      case (?r) {
        r.failures += 1;
        call_errors += 1;
        logError(self(), "Release " # k # ": canister_info failed (" # Nat.toText(r.failures) # "): " # clip(m, MAX_ERROR_TEXT));
        if (r.failures >= MAX_LIVE_FAILURES) {
          r.next_at := null;
          r.check := ?{ at = now(); target = ?r.target; result = #not_checked("could not read canister_info: " # clip(m, 200)); compared_with = ?r.module_hash; module_hash = null; installed_by = null; skipped = false; history_changes = 0; block = null };
        } else r.next_at := ?(now() + backoff(r.failures));
      };
      case null {};
    };
  };

  /// Reads the remaining pages of an asset canister's `list` (start at the first page's size) and
  /// records the tree hashes. Stops at an empty page, or when a page starts over (an asset canister
  /// that doesn't page). Bounded by max_asset_entries and max_asset_pages.
  func processAssets(ref : StepRef, target : Principal, first : [Live.AssetDetails]) : async* () {
    let t = switch (Map.get(proposals, Map.thash, ref.key)) { case (?t) t; case null return };
    let g = govRec(t.governance);
    let all = Buffer.Buffer<Live.AssetDetails>(first.size());
    for (a in first.vals()) all.add(a);
    var page = first;
    var pages = 1;
    label more while (page.size() > 0) {
      if (all.size() > config.max_asset_entries) return liveFailedFinal(t, ref.step, "the asset canister lists more than " # Nat.toText(config.max_asset_entries) # " assets");
      if (pages >= config.max_asset_pages) return liveFailedFinal(t, ref.step, "the asset list has more than " # Nat.toText(config.max_asset_pages) # " pages");
      if (not budgetTake(g, "asset list page")) return liveFailed(t, ref.step, "call budget spent while paging the asset list");
      countCall("asset.list");
      let next = try { await (with timeout = CALL_TIMEOUT) assetsOf(target).list({ start = ?all.size(); length = null }) } catch (e) {
        return liveFailed(t, ref.step, "asset list: " # Error.message(e));
      };
      pages += 1;
      if (next.size() == 0) break more;
      if (first.size() > 0 and next[0].key == first[0].key) break more; // not paging: the first page was everything
      for (a in next.vals()) all.add(a);
      page := next;
    };
    let h = Live.treeHashes(Buffer.toArray(all));
    let s = step(t, ref.step);
    recordLive(t, ref.step, {
      at = now();
      target = ?target;
      result = #asset_tree({ tree_sha256 = h.tree; identity_tree_sha256 = h.identity; assets = h.assets; encodings = h.encodings });
      compared_with = null;
      module_hash = null;
      installed_by = null;
      skipped = switch (Option.map<ProposalStep, T.Execution>(s, func(x) = x.execution)) { case (?#skipped _) true; case _ false };
      history_changes = 0;
      block = null;
    });
    maybeDone(t);
  };

  func liveFailedFinal(t : Tracked, i : Nat, m : Text) {
    recordLive(t, i, { at = now(); target = Option.chain<ProposalStep, Principal>(step(t, i), func(x) = x.target); result = #not_checked(m); compared_with = null; module_hash = null; installed_by = null; skipped = false; history_changes = 0; block = null });
    maybeDone(t);
  };


  /// One round: issue up to `n` calls (most urgent first: SNS roots for installer roles, live
  /// checks, releases, function lists, proposal reads; billed calls take from the DAO's budget),
  /// then await and process every reply. Returns the number of calls issued.
  func round(n : Nat) : async* Nat {
    // one buffer per kind of call (a future's type can't sit in a type declaration)
    let fRoots = Buffer.Buffer<async { instances : [{ root_canister_id : ?Principal; governance_canister_id : ?Principal }] }>(1);
    let fInfo = Buffer.Buffer<(StepRef, async Live.CanisterInfo)>(n);
    let fAssets = Buffer.Buffer<(StepRef, Principal, async [Live.AssetDetails])>(n);
    let fRelease = Buffer.Buffer<(Text, async Live.CanisterInfo)>(n);
    let fFns = Buffer.Buffer<(Principal, async SnsGov.ListFunctionsResponse)>(n);
    let fSns = Buffer.Buffer<(Text, async SnsGov.GetProposalResponse)>(n);
    let fOh = Buffer.Buffer<(Text, async ?Oh.ProposalUpgradeSteps)>(n);
    var issued = 0;
    let t0 = now();
    func room() : Bool = issued < n;
    func failSend(what : Text, e : Error) { call_errors += 1; logError(self(), "Could not send " # what # ": " # Error.message(e)) };

    // 1. the SNS roots (one SNS-W listing at most once an hour, when an SNS governance lacks one)
    if (sns_roots_wanted and t0 - sns_roots_at >= HOUR_NS and room()) {
      sns_roots_at := t0;
      sns_roots_wanted := false;
      try {
        let sw : SnsGov.SnsW = actor (Principal.toText(config.sns_wasm));
        fRoots.add((with timeout = CALL_TIMEOUT) sw.list_deployed_snses({}));
        issued += 1;
        countCall("sns_w.list_deployed_snses");
      } catch (e) failSend("list_deployed_snses", e);
    };

    // 2. live checks of executed steps (canister_info: management canister, not billed to the DAO;
    //    asset list: the DAO's asset canister, billed)
    label live for (k in Map.keys(active)) {
      if (not room()) break live;
      switch (Map.get(proposals, Map.thash, k)) {
        case (?t) switch (t.read) {
          case (?r) for (s in r.steps.vals()) {
            if (room()) switch (liveNeed(t, s), s.target) {
              case (#info, ?target) {
                try {
                  fInfo.add(({ key = k; step = s.index }, mgmt.canister_info({ canister_id = target; num_requested_changes = ?Live.HISTORY })));
                  issued += 1;
                  countCall("management.canister_info");
                } catch (e) failSend("canister_info", e);
              };
              case (#assets, ?target) {
                if (budgetTake(govRec(t.governance), "asset list")) {
                  try {
                    fAssets.add(({ key = k; step = s.index }, target, (with timeout = CALL_TIMEOUT) assetsOf(target).list({ start = ?0; length = null })));
                    issued += 1;
                    countCall("asset.list");
                  } catch (e) failSend("asset list", e);
                };
              };
              case _ {};
            };
          };
          case null {};
        };
        case null {};
      };
    };

    // 3. releases
    label rel for ((k, r) in Map.entries(releases)) {
      if (not room()) break rel;
      switch (r.next_at) {
        case (?at) if (at <= t0) {
          r.next_at := ?(t0 + backoff(r.failures + 1)); // until the reply arrives
          try {
            fRelease.add((k, mgmt.canister_info({ canister_id = r.target; num_requested_changes = ?Live.HISTORY })));
            issued += 1;
            countCall("management.canister_info");
          } catch (e) failSend("canister_info", e);
        };
        case null {};
      };
    };

    // 4. function lists wanted by a GNSF proposal read
    label fn for (g in Map.vals(govs)) {
      if (not room()) break fn;
      if (g.fns_wanted and g.kind == ?#sns and budgetTake(g, "list_nervous_system_functions")) {
        g.fns_wanted := false;
        try {
          fFns.add((g.governance, (with timeout = CALL_TIMEOUT) snsGov(g.governance).list_nervous_system_functions()));
          issued += 1;
          countCall("sns.list_nervous_system_functions");
        } catch (e) failSend("list_nervous_system_functions", e);
      };
    };

    // 5. proposal reads that are due: first those a known builder of the DAO attested (so spam
    //    attestations can't starve them of the DAO's budget), then the rest
    for (knownFirst in [true, false].vals()) label reads for (k in Map.keys(active)) {
      if (not room()) break reads;
      switch (Map.get(proposals, Map.thash, k)) {
        case (?t) if (not t.reads_done and t.next_at <= t0 and hasKnownAttestation(t) == knownFirst) {
          let g = govRec(t.governance);
          if (g.fns_wanted) {} // wait for the function list
          else if (budgetTake(g, "proposal read")) {
            t.next_at := t0 + backoff(t.failures + 1); // until the reply arrives
            try {
              switch (g.kind) {
                case (?#sns) { fSns.add((k, (with timeout = CALL_TIMEOUT) snsGov(t.governance).get_proposal({ proposal_id = ?{ id = t.proposal_id } }))); countCall("sns.get_proposal") };
                // unknown kind: OhShii's read first, then SNS's (below)
                case _ { fOh.add((k, (with timeout = CALL_TIMEOUT) ohGov(t.governance).get_proposal_upgrade_steps(t.proposal_id))); countCall("ohshii.get_proposal_upgrade_steps") };
              };
              issued += 1;
            } catch (e) failSend("proposal read", e);
          };
        };
        case null {};
      };
    };

    // ---- the replies ----
    for (fut in fRoots.vals()) {
      try {
        let r = await fut;
        var found = 0;
        for (i in r.instances.vals()) switch (i.governance_canister_id, i.root_canister_id) {
          case (?gp, ?root) switch (Map.get(govs, Map.phash, gp)) { case (?g) { g.sns_root := ?root; found += 1 }; case null {} };
          case _ {};
        };
        logInfo(self(), "SNS roots learned from SNS-W: " # Nat.toText(found) # " of " # Nat.toText(r.instances.size()) # " SNSes are watched");
      } catch (e) { call_errors += 1; logError(self(), "list_deployed_snses: " # Error.message(e)) };
    };
    for ((ref, fut) in fInfo.vals()) {
      try { processInfo(ref, await fut) } catch (e) {
        switch (Map.get(proposals, Map.thash, ref.key)) { case (?t) liveFailed(t, ref.step, "canister_info: " # Error.message(e)); case null {} };
      };
    };
    for ((ref, target, fut) in fAssets.vals()) {
      try { let first = await fut; await* processAssets(ref, target, first) } catch (e) {
        switch (Map.get(proposals, Map.thash, ref.key)) { case (?t) liveFailed(t, ref.step, "asset list: " # Error.message(e)); case null {} };
      };
    };
    for ((k, fut) in fRelease.vals()) {
      try { processRelease(k, await fut) } catch (e) { releaseFailed(k, Error.message(e)) };
    };
    for ((gp, fut) in fFns.vals()) {
      let g = govRec(gp);
      try {
        let r = await fut;
        g.fns := ?SnsGov.functionTargets(r);
        g.fns_at := now();
        logInfo(self(), "Functions of " # Principal.toText(gp) # ": " # Nat.toText(r.functions.size()));
      } catch (e) {
        call_errors += 1;
        g.fns_at := now();
        g.fns := ?Option.get(g.fns, []); // proceed without: GNSF proposals read as "not an upgrade"
        logError(self(), "list_nervous_system_functions of " # Principal.toText(gp) # ": " # Error.message(e));
      };
    };
    for ((k, fut) in fSns.vals()) {
      try { processSns(k, await fut) } catch (e) {
        switch (Map.get(proposals, Map.thash, k)) { case (?t) readFailed(t, "get_proposal: " # Error.message(e)); case null {} };
      };
    };
    for ((k, fut) in fOh.vals()) {
      switch (Map.get(proposals, Map.thash, k)) {
        case (?t) {
          let g = govRec(t.governance);
          try { processOh(t, await fut) } catch (e) {
            let m1 = Error.message(e);
            if (g.kind == ?#ohshii) readFailed(t, "get_proposal_upgrade_steps: " # m1) else {
              // unknown governance: is it an SNS?
              if (budgetTake(g, "proposal read (SNS probe)")) {
                countCall("sns.get_proposal");
                try { processSns(k, await (with timeout = CALL_TIMEOUT) snsGov(t.governance).get_proposal({ proposal_id = ?{ id = t.proposal_id } })) } catch (e2) {
                  readFailed(t, "neither get_proposal_upgrade_steps (" # clip(m1, 200) # ") nor SNS get_proposal (" # clip(Error.message(e2), 200) # ") answered");
                };
              } else t.next_at := now();
            };
          };
        };
        case null { ignore (try { await fut } catch (_) { null }) };
      };
    };
    issued;
  };

  func run() : async* () {
    var calls = 0;
    label rounds while (calls < config.max_calls_per_tick) {
      if (Cycles.balance() < config.min_cycles) {
        logError(self(), "Cycles below min_cycles (" # Nat.toText(Cycles.balance()) # "): no calls this tick");
        break rounds;
      };
      let issued = await* round(Nat.min(config.max_in_flight, config.max_calls_per_tick - calls));
      if (issued == 0) break rounds;
      calls += issued;
    };
  };

  func tickJob() : async () {
    kick_pending := false;
    if (config.paused) return;
    if (running and now() - run_started < STALE_RUN_NS) return;
    running := true;
    run_started := now();
    ticks += 1;
    last_tick_at := ?now();
    try { await* run() } catch (e) { logError(self(), "Tick failed: " # Error.message(e)) } finally { running := false };
  };

  func icrc3_timer_job() : async () { ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false) };

  func restartTick<system>() {
    switch tick_timer { case (?id) Timer.cancelTimer(id); case null {} };
    tick_timer := ?Timer.recurringTimer<system>(#seconds(config.tick_s), tickJob);
  };

  func ensure_timers<system>() {
    Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job);
    if (timers_started) return;
    timers_started := true;
    restartTick<system>();
  };

  // ---------------------------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------------------------

  func liveAgrees(a : Attestation, c : ?LiveCheck) : ?Bool = switch c {
    case null null;
    case (?c) switch (c.result, a.artifact) {
      case (#live_match or #live_mismatch _, #wasm(w)) switch (c.module_hash) {
        case (?h) ?(h == w.built_raw_sha256 or ?h == w.built_gz_sha256);
        case null ?false;
      };
      case (#asset_tree(x), #asset_batch(b)) ?(b.tree_sha256 == x.tree_sha256 or b.tree_sha256 == x.identity_tree_sha256);
      case _ null;
    };
  };

  func proposalAgrees(a : Attestation, s : ?ProposalStep) : ?Bool = switch s {
    case null null;
    case (?s) switch (s.artifact, a.artifact) {
      case (#wasm(p), #wasm(w)) switch (p.module_hash) { case (?h) ?(h == w.proposed_sha256); case null null };
      case (#asset_batch(p), #asset_batch(b)) switch (p.evidence, p.batch_id) {
        case (?e, ?id) ?(e == b.proposed_evidence and id == b.batch_id);
        case (?e, null) ?(e == b.proposed_evidence);
        case _ null;
      };
      case (#unknown _, _) null;
      case _ ?false; // the builder attested another kind of artifact than the step has
    };
  };

  func targetOf(a : Artifact) : Principal = switch a { case (#wasm(w)) w.target; case (#asset_batch(b)) b.target };

  func viewOf(a : Attestation, versions : Nat, s : ?ProposalStep, c : ?LiveCheck) : AttestationView = {
    attestation = a;
    known_builder = switch (subjectGovernance(a.subject)) { case (?g) isKnown(g, a.builder); case null false };
    versions;
    proposal_agrees = proposalAgrees(a, s);
    target_agrees = switch s { case (?st) Option.map<Principal, Bool>(st.target, func(x) = x == targetOf(a.artifact)); case null null };
    live_agrees = liveAgrees(a, c);
  };

  func contextOf(s : Subject) : (?ProposalStep, ?LiveCheck) = switch s {
    case (#proposal(p)) switch (Map.get(proposals, Map.thash, propKey(p.governance, p.proposal_id))) {
      case (?t) (step(t, p.step), lookupPair(t.live, p.step));
      case null (null, null);
    };
    case (#release(r)) switch (Map.get(releases, Map.thash, releaseKey(r.target, r.module_hash))) {
      case (?x) (null, x.check);
      case null (null, null);
    };
  };

  func views(s : Subject) : [AttestationView] {
    let (st, c) = contextOf(s);
    switch (Map.get(subjects, Map.thash, subjectKey(s))) {
      case (?r) {
        let out = Buffer.Buffer<AttestationView>(Map.size(r.by_builder));
        for (vs in Map.vals(r.by_builder)) if (vs.size() > 0) out.add(viewOf(vs[vs.size() - 1], vs.size(), st, c));
        Buffer.toArray(out);
      };
      case null [];
    };
  };

  func stepStatus(t : Tracked, i : Nat) : StepStatus {
    let s = step(t, i);
    let c = lookupPair(t.live, i);
    let atts = newest(subjectKey(#proposal({ governance = t.governance; proposal_id = t.proposal_id; step = i })));
    var m = 0; var mm = 0; var cn = 0; var km = 0; var kmm = 0; var kc = 0; var la = 0; var ld = 0;
    var proposed : ?Blob = null;
    var disagree = false;
    for (a in atts.vals()) {
      let known = isKnown(t.governance, a.builder);
      switch (a.verdict) {
        case (#match) { m += 1; if (known) km += 1 };
        case (#mismatch) { mm += 1; if (known) kmm += 1 };
        case (#cannot_verify _) { cn += 1; if (known) kc += 1 };
      };
      let p = switch (a.artifact) { case (#wasm(w)) w.proposed_sha256; case (#asset_batch(b)) b.proposed_evidence };
      switch proposed { case null proposed := ?p; case (?x) if (x != p) disagree := true };
      switch (liveAgrees(a, c)) { case (?true) la += 1; case (?false) ld += 1; case null {} };
    };
    let live = switch c {
      case (?x) switch (x.result) { case (#live_match) ?#live_match; case (#live_mismatch(r)) ?#live_mismatch(r); case _ null };
      case null null;
    };
    {
      step = i;
      proposed = s;
      attested_by = atts.size();
      builders_match = m;
      builders_mismatch = mm;
      builders_cannot = cn;
      known_match = km;
      known_mismatch = kmm;
      known_cannot = kc;
      proposed_disagree = disagree;
      builders_live_agree = la;
      builders_live_disagree = ld;
      live;
      live_check = c;
      installed_by = Option.chain<LiveCheck, Principal>(c, func(x) = Option.map<T.Installer, Principal>(x.installed_by, func(i) = i.principal));
    };
  };

  func stepIndexes(t : Tracked) : [Nat] {
    let out = Buffer.Buffer<Nat>(4);
    switch (t.read) { case (?r) for (s in r.steps.vals()) out.add(s.index); case null {} };
    for (i in t.steps_attested.vals()) if (not Buffer.contains<Nat>(out, i, Nat.equal)) out.add(i);
    Array.sort<Nat>(Buffer.toArray(out), Nat.compare);
  };

  func statusOf(t : Tracked) : ProposalStatus = {
    governance = t.governance;
    proposal_id = t.proposal_id;
    kind = Option.chain<GovRec, GovernanceKind>(Map.get(govs, Map.phash, t.governance), func(g) = g.kind);
    read = t.read;
    read_error = t.read_error;
    watch = t.watch;
    next_check_at = if (t.watch == #watching and not t.reads_done) ?t.next_at else null;
    first_attested_at = t.created_at;
    steps = Array.map<Nat, StepStatus>(stepIndexes(t), func(i) = stepStatus(t, i));
  };

  func summaryOf(t : Tracked) : ProposalSummary {
    let st = statusOf(t);
    let seen = Buffer.Buffer<Principal>(4);
    var m = 0; var mm = 0; var cn = 0; var lm = 0; var lmm = 0;
    for (s in st.steps.vals()) {
      m += s.builders_match;
      mm += s.builders_mismatch;
      cn += s.builders_cannot;
      switch (s.live) { case (?#live_match) lm += 1; case (?#live_mismatch _) lmm += 1; case null {} };
      for (a in newest(subjectKey(#proposal({ governance = t.governance; proposal_id = t.proposal_id; step = s.step }))).vals()) {
        if (not Buffer.contains<Principal>(seen, a.builder, Principal.equal)) seen.add(a.builder);
      };
    };
    {
      governance = t.governance;
      proposal_id = t.proposal_id;
      status = Option.map<ProposalRead, Text>(t.read, func(r) = r.status);
      watch = t.watch;
      steps = st.steps.size();
      builders = seen.size();
      builders_match = m;
      builders_mismatch = mm;
      builders_cannot = cn;
      live_match = lm;
      live_mismatch = lmm;
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------------------------

  /// The newest attestation of each builder for a subject, with what the registry knows of it.
  public query func get_attestations(s : Subject) : async [AttestationView] { views(s) };

  /// One builder's attestations for a subject still in state, oldest first (older ones: the log).
  public query func get_attestation_history(s : Subject, b : Principal) : async [Attestation] {
    switch (Map.get(subjects, Map.thash, subjectKey(s))) {
      case (?r) Option.get(Map.get(r.by_builder, Map.phash, b), []);
      case null [];
    };
  };

  /// Everything about one proposal: the read, each step's builder counts and the live check.
  public query func get_proposal_status(governance : Principal, proposal_id : Nat64) : async ?ProposalStatus {
    Option.map<Tracked, ProposalStatus>(Map.get(proposals, Map.thash, propKey(governance, proposal_id)), statusOf);
  };

  /// Compact summaries for proposal lists (at most 100 ids; unknown ids are left out).
  public query func get_proposal_summaries(governance : Principal, ids : [Nat64]) : async [ProposalSummary] {
    let out = Buffer.Buffer<ProposalSummary>(ids.size());
    for (id in Array.subArray<Nat64>(ids, 0, Nat.min(ids.size(), MAX_IDS)).vals()) {
      switch (Map.get(proposals, Map.thash, propKey(governance, id))) { case (?t) out.add(summaryOf(t)); case null {} };
    };
    Buffer.toArray(out);
  };

  /// Every proposal the registry has attestations for, in the order first attested.
  public query func list_proposals(start : Nat, limit : Nat) : async { items : [ProposalSummary]; total : Nat } {
    let n = Nat.min(limit, MAX_PAGE);
    let out = Buffer.Buffer<ProposalSummary>(n);
    var i = 0;
    label l for (t in Map.vals(proposals)) {
      if (out.size() >= n) break l;
      if (i >= start) out.add(summaryOf(t));
      i += 1;
    };
    { items = Buffer.toArray(out); total = Map.size(proposals) };
  };

  public query func get_release_status(target : Principal, module_hash : Blob) : async ?ReleaseStatus {
    switch (Map.get(releases, Map.thash, releaseKey(target, module_hash))) {
      case (?r) ?{ target; module_hash; attestations = views(#release({ target; module_hash })); live_check = r.check; next_check_at = r.next_at };
      case null null;
    };
  };

  public query func get_builder(b : Principal) : async ?BuilderProfile { profileOf(b) };

  public query func list_builders(start : Nat, limit : Nat) : async { items : [BuilderProfile]; total : Nat } {
    let n = Nat.min(limit, MAX_PAGE);
    let out = Buffer.Buffer<BuilderProfile>(n);
    var i = 0;
    label l for (b in Map.keys(builders)) {
      if (out.size() >= n) break l;
      switch (profileOf(b)) { case (?p) { if (i >= start) out.add(p); i += 1 }; case null {} };
    };
    { items = Buffer.toArray(out); total = Map.size(builders) };
  };

  public query func get_known_builders(governance : Principal) : async ?KnownBuilders {
    Option.chain<GovRec, KnownBuilders>(Map.get(govs, Map.phash, governance), func(g) = g.known);
  };

  /// The calls this registry makes to other DAOs' canisters, its per-DAO budget and current use.
  public query func get_call_budget() : async CallBudget {
    let daos = Buffer.Buffer<T.DaoUsage>(Map.size(govs));
    let watching = Map.new<Principal, Nat>();
    for (k in Map.keys(active)) switch (Map.get(proposals, Map.thash, k)) {
      case (?t) Map.set(watching, Map.phash, t.governance, Option.get(Map.get(watching, Map.phash, t.governance), 0) + 1);
      case null {};
    };
    for (g in Map.vals(govs)) {
      let watched = Option.get(Map.get(watching, Map.phash, g.governance), 0);
      daos.add({
        governance = g.governance;
        kind = g.kind;
        sns_root = g.sns_root;
        calls_this_hour = if (now() - g.window_start >= HOUR_NS) 0 else g.calls_in_window;
        calls_total = g.calls_total;
        throttled_hours = g.throttled;
        backoff_until = switch (g.backoff_until) { case (?u) if (u > now()) ?u else null; case null null };
        watched_proposals = watched;
      });
    };
    {
      calls_per_hour_per_dao = config.calls_per_hour_per_dao;
      max_in_flight = config.max_in_flight;
      principals = [("ic", MAINNET_ID), ("staging", STAGING_ID)];
      methods = [
        { canister = "SNS governance"; method = "get_proposal"; when = "per attested proposal: hourly while open (and a minute after its deadline), every " # Nat.toText(config.poll_executing_s) # " s once adopted, until executed or failed"; billed_to_dao = true },
        { canister = "SNS governance"; method = "list_nervous_system_functions"; when = "once per generic-function proposal kind, at most hourly"; billed_to_dao = true },
        { canister = "ONS / SONS governance"; method = "get_proposal_upgrade_steps"; when = "per attested proposal: hourly while pending, every " # Nat.toText(config.poll_executing_s) # " s while executing, until every step is final"; billed_to_dao = true },
        { canister = "asset canister"; method = "list"; when = "once per executed frontend step (one call per page)"; billed_to_dao = true },
        { canister = "management canister"; method = "canister_info"; when = "once per executed step and per release"; billed_to_dao = false },
        { canister = "SNS-W"; method = "list_deployed_snses"; when = "at most hourly, when a watched SNS's root is unknown"; billed_to_dao = false },
      ];
      estimate = "Per attested proposal: about one read an hour while voting is open (a 4-day SNS vote: ~100 reads), one read every " # Nat.toText(config.poll_executing_s) # " s while it executes (usually one or two), then one canister_info per step (not billed to the DAO) and, for frontend steps, one asset list per page. Proposals without attestations are never read. Hard cap: " # Nat.toText(config.calls_per_hour_per_dao) # " billed calls per DAO per hour; over it, the DAO is skipped until the next hour, then twice as long each consecutive time (at most " # Nat.toText(config.max_backoff_s / 3600) # " h).";
      daos = Buffer.toArray(daos);
    };
  };

  public query func get_config() : async Config { config };

  public query func get_limits() : async Limits {
    {
      max_text_repo = MAX_REPO;
      max_text_commit = MAX_COMMIT;
      max_text_recipe = MAX_RECIPE;
      max_text_environment = MAX_ENV;
      max_text_url = MAX_URL;
      max_text_reason = MAX_REASON;
      max_text_name = MAX_NAME;
      max_text_description = MAX_DESCRIPTION;
      max_embedded = MAX_EMBEDDED;
      hash_bytes = HASH_BYTES;
    };
  };

  /// The exact definition of the asset tree hash.
  public query func get_tree_hash_format() : async Text { Live.TREE_HASH_FORMAT };

  public query func get_stats() : async Stats {
    {
      subjects = Map.size(subjects);
      attestations = attestations_stored;
      attestations_ever;
      builders = Map.size(builders);
      proposals_watched = Map.size(active);
      proposals_total = Map.size(proposals);
      releases = Map.size(releases);
      live_checks;
      calls = Map.toArray(call_counts);
      call_errors;
      ticks;
      last_tick_at;
      cycles = Cycles.balance();
    };
  };

  public query func get_rate_limits() : async [(Text, RateLimit.Rule)] { RateRules.all(rate_rules, RATE_DEFAULTS) };

  /// The text log (reads, live checks, budget, admin actions). Public: nothing here is private.
  public query func get_log(start : Nat, length : Nat) : async [LogEntry] { TextLog.get(textlog, start, length) };

  public query func get_api_doc() : async Text { ApiDoc.text };

  // ---------------------------------------------------------------------------------------------
  // Admin: controllers only, maintenance only. Nothing here can change or remove an attestation.
  // ---------------------------------------------------------------------------------------------

  func configBlock(caller : Principal, key : Text, old : T3.Value, new : T3.Value) {
    ignore block("config", caller, [("key", #Text(key)), ("old", old), ("new", new)]);
  };

  func checkConfig(c : Config) : ?Text {
    if (c.tick_s < 10 or c.tick_s > 3_600) return ?"tick_s must be 10-3600";
    if (c.max_in_flight < 1 or c.max_in_flight > 10) return ?"max_in_flight must be 1-10";
    if (c.max_calls_per_tick < 1 or c.max_calls_per_tick > 500) return ?"max_calls_per_tick must be 1-500";
    if (c.calls_per_hour_per_dao < 1 or c.calls_per_hour_per_dao > 10_000) return ?"calls_per_hour_per_dao must be 1-10000";
    if (c.max_backoff_s < 3_600 or c.max_backoff_s > 7 * 86_400) return ?"max_backoff_s must be 3600-604800";
    if (c.poll_open_s < 60 or c.poll_executing_s < 30) return ?"poll_open_s must be at least 60 and poll_executing_s at least 30";
    if (c.max_watch_s < 86_400) return ?"max_watch_s must be at least a day";
    if (c.max_read_failures < 1 or c.max_read_failures > 100) return ?"max_read_failures must be 1-100";
    if (c.max_subjects < 1 or c.max_subjects > 1_000_000 or c.max_attestations < 1 or c.max_attestations > 10_000_000) return ?"max_subjects must be 1-1000000 and max_attestations 1-10000000";
    if (c.max_versions_per_builder < 1 or c.max_versions_per_builder > 100) return ?"max_versions_per_builder must be 1-100";
    if (c.max_builders_per_subject < 1 or c.max_builders_per_subject > 1_000) return ?"max_builders_per_subject must be 1-1000";
    if (c.max_steps < 1 or c.max_steps > 200) return ?"max_steps must be 1-200";
    if (c.max_asset_entries < 1 or c.max_asset_entries > 100_000 or c.max_asset_pages < 1 or c.max_asset_pages > 1_000) return ?"max_asset_entries must be 1-100000 and max_asset_pages 1-1000";
    if (c.max_known_builders > 500) return ?"max_known_builders must be at most 500";
    if (c.archive_controllers.size() > 10) return ?"at most 10 archive controllers";
    null;
  };

  public shared ({ caller }) func admin_set_config(u : ConfigUpdate) : async T.Result<Config> {
    if (not isController(caller)) return #err("Controllers only");
    let o = config;
    let c : Config = {
      paused = Option.get(u.paused, o.paused);
      tick_s = Option.get(u.tick_s, o.tick_s);
      max_in_flight = Option.get(u.max_in_flight, o.max_in_flight);
      max_calls_per_tick = Option.get(u.max_calls_per_tick, o.max_calls_per_tick);
      calls_per_hour_per_dao = Option.get(u.calls_per_hour_per_dao, o.calls_per_hour_per_dao);
      max_backoff_s = Option.get(u.max_backoff_s, o.max_backoff_s);
      poll_open_s = Option.get(u.poll_open_s, o.poll_open_s);
      poll_executing_s = Option.get(u.poll_executing_s, o.poll_executing_s);
      max_watch_s = Option.get(u.max_watch_s, o.max_watch_s);
      max_read_failures = Option.get(u.max_read_failures, o.max_read_failures);
      max_subjects = Option.get(u.max_subjects, o.max_subjects);
      max_attestations = Option.get(u.max_attestations, o.max_attestations);
      max_builders_per_subject = Option.get(u.max_builders_per_subject, o.max_builders_per_subject);
      max_versions_per_builder = Option.get(u.max_versions_per_builder, o.max_versions_per_builder);
      max_steps = Option.get(u.max_steps, o.max_steps);
      max_asset_entries = Option.get(u.max_asset_entries, o.max_asset_entries);
      max_asset_pages = Option.get(u.max_asset_pages, o.max_asset_pages);
      max_known_builders = Option.get(u.max_known_builders, o.max_known_builders);
      max_known_lists = Option.get(u.max_known_lists, o.max_known_lists);
      min_cycles = Option.get(u.min_cycles, o.min_cycles);
      sns_wasm = Option.get(u.sns_wasm, o.sns_wasm);
      archive_controllers = Option.get(u.archive_controllers, o.archive_controllers);
    };
    switch (checkConfig(c)) { case (?e) return #err(e); case null {} };
    func n(key : Text, a : Nat, b : Nat) { if (a != b) configBlock(caller, key, #Nat(a), #Nat(b)) };
    if (o.paused != c.paused) configBlock(caller, "paused", #Nat(if (o.paused) 1 else 0), #Nat(if (c.paused) 1 else 0));
    n("tick_s", o.tick_s, c.tick_s);
    n("max_in_flight", o.max_in_flight, c.max_in_flight);
    n("max_calls_per_tick", o.max_calls_per_tick, c.max_calls_per_tick);
    n("calls_per_hour_per_dao", o.calls_per_hour_per_dao, c.calls_per_hour_per_dao);
    n("max_backoff_s", o.max_backoff_s, c.max_backoff_s);
    n("poll_open_s", o.poll_open_s, c.poll_open_s);
    n("poll_executing_s", o.poll_executing_s, c.poll_executing_s);
    n("max_watch_s", o.max_watch_s, c.max_watch_s);
    n("max_read_failures", o.max_read_failures, c.max_read_failures);
    n("max_subjects", o.max_subjects, c.max_subjects);
    n("max_attestations", o.max_attestations, c.max_attestations);
    n("max_builders_per_subject", o.max_builders_per_subject, c.max_builders_per_subject);
    n("max_versions_per_builder", o.max_versions_per_builder, c.max_versions_per_builder);
    n("max_steps", o.max_steps, c.max_steps);
    n("max_asset_entries", o.max_asset_entries, c.max_asset_entries);
    n("max_asset_pages", o.max_asset_pages, c.max_asset_pages);
    n("max_known_builders", o.max_known_builders, c.max_known_builders);
    n("max_known_lists", o.max_known_lists, c.max_known_lists);
    n("min_cycles", o.min_cycles, c.min_cycles);
    if (o.sns_wasm != c.sns_wasm) configBlock(caller, "sns_wasm", pv(o.sns_wasm), pv(c.sns_wasm));
    if (o.archive_controllers != c.archive_controllers) configBlock(caller, "archive_controllers", #Array(Array.map<Principal, T3.Value>(o.archive_controllers, pv)), #Array(Array.map<Principal, T3.Value>(c.archive_controllers, pv)));
    config := c;
    if (o.tick_s != c.tick_s) restartTick<system>();
    logInfo(caller, "Config updated" # (if (c.paused) " (paused)" else ""));
    #ok(c);
  };


  /// Sets (or clears, to probe again) which adapter reads a governance canister's proposals.
  public shared ({ caller }) func admin_set_governance_kind(governance : Principal, kind : ?GovernanceKind) : async T.Result<()> {
    if (not isController(caller)) return #err("Controllers only");
    let g = govRec(governance);
    g.kind := kind;
    ignore block("governance_kind", caller, [("governance", pv(governance)), ("kind", #Text(switch kind { case (?k) kindText(k); case null "unknown" })), ("how", #Text("admin"))]);
    logInfo(caller, "Governance kind of " # Principal.toText(governance) # " set by a controller");
    #ok(());
  };

  /// Watches a proposal again (after it was stopped, e.g. unreadable while a DAO admitted the
  /// registry): reads resume now; live checks already recorded are kept.
  public shared ({ caller }) func admin_recheck(governance : Principal, proposal_id : Nat64) : async T.Result<()> {
    if (not isController(caller)) return #err("Controllers only");
    let k = propKey(governance, proposal_id);
    switch (Map.get(proposals, Map.thash, k)) {
      case (?t) {
        t.watch := #watching;
        t.reads_done := false;
        t.failures := 0;
        t.live_failures := [];
        t.next_at := now();
        Map.set(active, Map.thash, k, ());
        logInfo(caller, "Recheck of " # propDesc(t) # " requested by a controller");
        kick<system>();
        #ok(());
      };
      case null #err("The registry has no attestation for this proposal");
    };
  };

  public shared ({ caller }) func admin_recheck_release(target : Principal, module_hash : Blob) : async T.Result<()> {
    if (not isController(caller)) return #err("Controllers only");
    switch (Map.get(releases, Map.thash, releaseKey(target, module_hash))) {
      case (?r) { r.failures := 0; r.next_at := ?now(); logInfo(caller, "Recheck of release " # releaseKey(target, module_hash)); kick<system>(); #ok(()) };
      case null #err("The registry has no attestation for this release");
    };
  };

  /// Runs a polling round now (it also runs every tick_s seconds).
  public shared ({ caller }) func admin_run_now() : async T.Result<()> {
    if (not isController(caller)) return #err("Controllers only");
    kick_pending := false;
    kick<system>();
    #ok(());
  };

  public shared ({ caller }) func admin_set_rate_limit(action : Text, rule : ?RateLimit.Rule) : async T.Result<()> {
    if (not isController(caller)) return #err("Controllers only");
    switch (RateRules.set(rate_rules, RATE_DEFAULTS, action, rule)) {
      case (#ok(r)) { rate_rules := r; logInfo(caller, "Rate limit " # action # " set"); #ok(()) };
      case (#err(e)) #err(e);
    };
  };

  public shared ({ caller }) func admin_set_icrc3_settings(u : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
    if (not isController(caller)) return #Err("Controllers only");
    switch (Icrc3Log.applySettings(icrc3, u)) {
      case (#Err(e)) #Err(e);
      case (#Ok(changes)) {
        for ((key, old, new) in changes.vals()) configBlock(caller, "icrc3." # key, #Nat(old), #Nat(new));
        #Ok(icrc3.settings);
      };
    };
  };

  public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
    if (not isController(caller)) return #Err("Controllers only");
    if (icrc3_rt.spilling) return #Err("A spill is already in progress");
    #Ok(await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true));
  };

  public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async { #Ok : [(Principal, { #Ok; #Err : Text })]; #Err : Text } {
    if (not isController(caller)) return #Err("Controllers only");
    #Ok(await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env()));
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

  system func postupgrade() {
    Icrc3Log.certify(icrc3);
    ensure_timers<system>();
  };

  // ---------------------------------------------------------------------------------------------
  // Ingress guard (src/IngressGuard.mo)
  // ---------------------------------------------------------------------------------------------

  system func inspect({ caller : Principal; arg : Blob; msg : {
    #admin_icrc3_repair_archive_controllers : Any;
    #admin_icrc3_spill_now : Any;
    #admin_recheck : Any;
    #admin_recheck_release : Any;
    #admin_run_now : Any;
    #admin_set_config : Any;
    #admin_set_governance_kind : Any;
    #admin_set_icrc3_settings : Any;
    #admin_set_rate_limit : Any;
    #attest : Any;
    #get_api_doc : Any;
    #get_attestation_history : Any;
    #get_attestations : Any;
    #get_builder : Any;
    #get_call_budget : Any;
    #get_config : Any;
    #get_known_builders : Any;
    #get_limits : Any;
    #get_log : Any;
    #get_proposal_status : Any;
    #get_proposal_summaries : Any;
    #get_rate_limits : Any;
    #get_release_status : Any;
    #get_stats : Any;
    #get_tree_hash_format : Any;
    #icrc10_supported_standards : Any;
    #icrc3_get_archives : Any;
    #icrc3_get_blocks : Any;
    #icrc3_get_tip_certificate : Any;
    #icrc3_log_status : Any;
    #icrc3_supported_block_types : Any;
    #list_builders : Any;
    #list_proposals : Any;
    #set_builder_profile : Any;
    #set_known_builders : Any;
    #validate_set_known_builders : Any;
  } }) : Bool {
    switch msg {
      // queries (the validator included) are free as queries; as updates the canister would pay
      case (#get_api_doc _ or #get_attestation_history _ or #get_attestations _ or #get_builder _ or #get_call_budget _ or #get_config _ or #get_known_builders _ or #get_limits _ or #get_log _ or #get_proposal_status _ or #get_proposal_summaries _ or #get_rate_limits _ or #get_release_status _ or #get_stats _ or #get_tree_hash_format _ or #list_builders _ or #list_proposals _ or #validate_set_known_builders _) false;
      case (#icrc10_supported_standards _ or #icrc3_get_archives _ or #icrc3_get_blocks _ or #icrc3_get_tip_certificate _ or #icrc3_log_status _ or #icrc3_supported_block_types _) false;
      // a DAO's governance canister calls this, always inter-canister
      case (#set_known_builders _) false;
      case (#attest _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.textArg(MAX_REPO + MAX_COMMIT + MAX_RECIPE + MAX_ENV + MAX_URL + MAX_REASON + MAX_EMBEDDED * MAX_NAME) + 2_048 and rateAllows(caller, "attest");
      case (#set_builder_profile _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.textArg(MAX_NAME + 2 * MAX_URL + MAX_DESCRIPTION) and rateAllows(caller, "profile");
      case (#admin_set_config _ or #admin_set_rate_limit _ or #admin_set_icrc3_settings _) isController(caller) and arg.size() <= IngressGuard.SMALL_ARG + 1_024;
      case (#admin_icrc3_repair_archive_controllers _ or #admin_icrc3_spill_now _ or #admin_recheck _ or #admin_recheck_release _ or #admin_run_now _ or #admin_set_governance_kind _) isController(caller) and arg.size() <= IngressGuard.SMALL_ARG;
    };
  };

  ensure_timers<system>();
};
